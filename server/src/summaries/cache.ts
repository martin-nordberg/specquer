import { Database } from "bun:sqlite";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { ensureUserFolder } from "../user-folder.ts";

/**
 * The summary cache, `.specquer/cache/summaries.db` (SQLite through `bun:sqlite`). An entry is
 * keyed by its text (simplified, with the sentence count), the model and the prompt version, so
 * another model's summary of the same text can be found. Entries unused for 60 days are deleted
 * (Step 005, D2). The folder gets a `.gitignore` whenever it has none, so the cache is never
 * committed. A damaged database is moved aside and created again, and one written by an older
 * version of Specquer is emptied; the cache never stops the server.
 */

export const CACHE_FOLDER = join(".specquer", "cache");
export const CACHE_FILE = join(CACHE_FOLDER, "summaries.db");
export const MAX_UNUSED = 60 * 24 * 60 * 60 * 1000;
/** `PRAGMA user_version` of the current schema; any other version is dropped (Step 005, D4). */
export const SCHEMA_VERSION = 2;

export interface CachedSummary {
  summary: string;
  /** The name of the model that made it, as shown to the user. */
  model: string;
  truncated: boolean;
}

/** A summary found for some model: `current` when it is the requested model's and prompt version's. */
export interface FoundSummary extends CachedSummary {
  current: boolean;
}

/** Which entry: the text's key, the model's key (`modelKey`) and the prompt version. */
export interface EntryKey {
  text: string;
  model: string;
  promptVersion: number;
}

/** The text part of the key: a hash of the simplified text and the sentence count (Step 005, D1). */
export function textKey(text: string, sentences: number): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify([text, sentences])).digest("hex");
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS summaries (
  text_key TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  model_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  truncated INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (text_key, model, prompt_version)
)`;

type Row = { summary: string; model_name: string; truncated: number };

export class SummaryCache {
  private db: Database | null = null;
  private opening: Promise<Database | null> | null = null;
  /** Closed for good: nothing opens the database again, so no late write recreates the folder. */
  private closed = false;
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
    if (this.closed) return Promise.resolve(null);
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
    if (this.closed) return null;
    try {
      this.db = this.connect();
    } catch (err) {
      // Damaged: keep it for inspection and start again
      const aside = `${this.file}.damaged-${this.now()}`;
      this.warn(`${CACHE_FILE} can't be read (${(err as Error).message}); moved to ${aside}`);
      try {
        await rename(this.file, aside);
        for (const suffix of ["-wal", "-shm"]) await rename(this.file + suffix, aside + suffix).catch(() => undefined);
        if (this.closed) return null;
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
      const { user_version } = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!;
      if (user_version !== SCHEMA_VERSION) {
        db.transaction(() => {
          db.run("DROP TABLE IF EXISTS summaries");
          db.run(SCHEMA);
          db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        })();
      }
      db.query("SELECT count(*) FROM summaries").get();
      return db;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  /** Creates `.specquer/cache/` with a `.gitignore` that keeps the cache out of Git. */
  private ensureFolder(): Promise<void> {
    return ensureUserFolder(this.folder);
  }

  /** The entry for `key`, marked as used. */
  async get(key: EntryKey): Promise<CachedSummary | undefined> {
    const db = await this.open();
    if (db === null) return undefined;
    try {
      const params = { text: key.text, model: key.model, promptVersion: key.promptVersion };
      const row = db
        .query<Row, typeof params>("SELECT summary, model_name, truncated FROM summaries WHERE text_key = $text AND model = $model AND prompt_version = $promptVersion")
        .get(params);
      if (row === null) return undefined;
      db.query("UPDATE summaries SET used_at = $now WHERE text_key = $text AND model = $model AND prompt_version = $promptVersion").run({ ...params, now: this.now() });
      return { summary: row.summary, model: row.model_name, truncated: row.truncated !== 0 };
    } catch (err) {
      this.warn(`reading the summary cache failed: ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * The best entry for the text, marked as used (Step 005, D7): the requested model's with the
   * prompt version, then another model's with the same prompt version, newest first, then one
   * from an older prompt version, newest first. `model` may be `undefined` (no model configured).
   */
  async best(text: string, model: string | undefined, promptVersion: number): Promise<FoundSummary | undefined> {
    const db = await this.open();
    if (db === null) return undefined;
    try {
      const params = { text, model: model ?? "", promptVersion };
      const row = db
        .query<Row & { current: number; model: string; prompt_version: number }, typeof params>(
          `SELECT summary, model_name, truncated, model, prompt_version, (model = $model AND prompt_version = $promptVersion) AS current
           FROM summaries WHERE text_key = $text
           ORDER BY current DESC, prompt_version = $promptVersion DESC, prompt_version DESC, created_at DESC LIMIT 1`,
        )
        .get(params);
      if (row === null) return undefined;
      db.query("UPDATE summaries SET used_at = $now WHERE text_key = $text AND model = $model AND prompt_version = $promptVersion").run({
        text,
        model: row.model,
        promptVersion: row.prompt_version,
        now: this.now(),
      });
      return { summary: row.summary, model: row.model_name, truncated: row.truncated !== 0, current: row.current !== 0 };
    } catch (err) {
      this.warn(`reading the summary cache failed: ${(err as Error).message}`);
      return undefined;
    }
  }

  async put(key: EntryKey, value: CachedSummary): Promise<void> {
    const db = await this.open();
    if (db === null) return;
    try {
      const now = this.now();
      db.query(
        `INSERT OR REPLACE INTO summaries (text_key, model, prompt_version, model_name, summary, truncated, created_at, used_at)
         VALUES ($text, $model, $promptVersion, $modelName, $summary, $truncated, $now, $now)`,
      ).run({ text: key.text, model: key.model, promptVersion: key.promptVersion, modelName: value.model, summary: value.summary, truncated: value.truncated ? 1 : 0, now });
    } catch (err) {
      this.warn(`writing the summary cache failed: ${(err as Error).message}`);
    }
  }

  /** Deletes entries unused for 60 days; returns how many. */
  async purge(): Promise<number> {
    const db = await this.open();
    if (db === null) return 0;
    try {
      return db.query("DELETE FROM summaries WHERE used_at < $since").run({ since: this.now() - MAX_UNUSED }).changes;
    } catch (err) {
      this.warn(`purging the summary cache failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Closes the database for good, once an opening under way has finished; later calls find no cache. */
  async close(): Promise<void> {
    this.closed = true;
    await this.opening;
    this.db?.close();
    this.db = null;
  }
}
