import { Database } from "bun:sqlite";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

/**
 * The summary cache, `.specquer/cache/summaries.db` (SQLite through `bun:sqlite`). Summaries
 * older than 30 days are ignored and deleted, whether used or not (decision D8). The folder gets
 * a `.gitignore` when it is created, so the cache is never committed. A damaged database is moved
 * aside and created again; the cache never stops the server.
 */

export const CACHE_FOLDER = join(".specquer", "cache");
export const CACHE_FILE = join(CACHE_FOLDER, "summaries.db");
export const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export interface CachedSummary {
  summary: string;
  model: string;
  truncated: boolean;
}

/** The cache key: a hash of the simplified text, the model ID, the prompt version and the sentence count. */
export function cacheKey(text: string, model: string, promptVersion: number, sentences: number): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify([text, model, promptVersion, sentences])).digest("hex");
}

const SCHEMA = "CREATE TABLE IF NOT EXISTS summaries (key TEXT PRIMARY KEY, model TEXT, prompt_version INTEGER, summary TEXT, truncated INTEGER, created_at INTEGER)";

export class SummaryCache {
  private db: Database | null = null;
  private opening: Promise<Database | null> | null = null;
  private readonly folder: string;
  private readonly file: string;

  constructor(
    root: string,
    private readonly now: () => number = Date.now,
    private readonly warn: (message: string) => void = (message) => console.warn(`specquer: ${message}`),
  ) {
    this.folder = join(root, CACHE_FOLDER);
    this.file = join(root, CACHE_FILE);
  }

  /** Whether the database file exists (it is created on first use). */
  exists(): Promise<boolean> {
    return Bun.file(this.file).exists();
  }

  private open(): Promise<Database | null> {
    if (this.db !== null) return Promise.resolve(this.db);
    this.opening ??= this.create().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async create(): Promise<Database | null> {
    try {
      await this.ensureFolder();
    } catch (err) {
      this.warn(`can't create ${CACHE_FOLDER}: ${(err as Error).message}`);
      return null;
    }
    try {
      this.db = this.connect();
    } catch (err) {
      // Damaged: keep it for inspection and start again
      const aside = `${this.file}.damaged-${this.now()}`;
      this.warn(`${CACHE_FILE} can't be read (${(err as Error).message}); moved to ${aside}`);
      try {
        await rename(this.file, aside);
        for (const suffix of ["-wal", "-shm"]) await rename(this.file + suffix, aside + suffix).catch(() => undefined);
        this.db = this.connect();
      } catch (again) {
        this.warn(`summaries won't be cached: ${(again as Error).message}`);
        this.db = null;
      }
    }
    return this.db;
  }

  private connect(): Database {
    const db = new Database(this.file, { create: true, strict: true });
    try {
      db.run("PRAGMA journal_mode = WAL");
      db.run(SCHEMA);
      db.query("SELECT count(*) FROM summaries").get();
      return db;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  /** Creates `.specquer/cache/` with a `.gitignore` that keeps the cache out of Git. */
  private async ensureFolder(): Promise<void> {
    const created = await mkdir(this.folder, { recursive: true });
    if (created === undefined) return;
    const gitignore = Bun.file(join(this.folder, ".gitignore"));
    if (!(await gitignore.exists())) await Bun.write(gitignore, "*\n");
  }

  async get(key: string): Promise<CachedSummary | undefined> {
    const db = await this.open();
    if (db === null) return undefined;
    try {
      const row = db
        .query<{ summary: string; model: string; truncated: number }, { key: string; since: number }>(
          "SELECT summary, model, truncated FROM summaries WHERE key = $key AND created_at >= $since",
        )
        .get({ key, since: this.now() - MAX_AGE });
      return row === null ? undefined : { summary: row.summary, model: row.model, truncated: row.truncated !== 0 };
    } catch (err) {
      this.warn(`reading the summary cache failed: ${(err as Error).message}`);
      return undefined;
    }
  }

  async put(key: string, promptVersion: number, value: CachedSummary): Promise<void> {
    const db = await this.open();
    if (db === null) return;
    try {
      db.query(
        "INSERT OR REPLACE INTO summaries (key, model, prompt_version, summary, truncated, created_at) VALUES ($key, $model, $promptVersion, $summary, $truncated, $createdAt)",
      ).run({ key, model: value.model, promptVersion, summary: value.summary, truncated: value.truncated ? 1 : 0, createdAt: this.now() });
    } catch (err) {
      this.warn(`writing the summary cache failed: ${(err as Error).message}`);
    }
  }

  /** Deletes summaries older than 30 days; returns how many. */
  async purge(): Promise<number> {
    const db = await this.open();
    if (db === null) return 0;
    try {
      return db.query("DELETE FROM summaries WHERE created_at < $since").run({ since: this.now() - MAX_AGE }).changes;
    } catch (err) {
      this.warn(`purging the summary cache failed: ${(err as Error).message}`);
      return 0;
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
