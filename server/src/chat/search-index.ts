import { Database } from "bun:sqlite";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { estimateTokens } from "@specquer/agent";
import { FILE_CALLS, mapLimit } from "../limit.ts";
import { CACHE_FOLDER } from "../summaries/cache.ts";
import { ensureUserFolder } from "../user-folder.ts";
import { type SearchUnit, searchUnits } from "./units.ts";

/**
 * The full-text index for document chat (Step 010, R4): every Markdown file the tree shows, split
 * into heading units, in an SQLite FTS5 table in `.specquer/cache/search.db` (per user, ignored by
 * Git). A file is indexed again when its modification time or size changes. Building it sends
 * nothing anywhere. A damaged database is moved aside and created again; one from another schema
 * version is rebuilt; the index never stops the server.
 */

export const SEARCH_FILE = join(CACHE_FOLDER, "search.db");
/** `PRAGMA user_version` of the current schema. */
export const SEARCH_SCHEMA_VERSION = 1;
/** Retrieved rows per unit wanted, before the open file's boost and the budget (decision D5). */
const OVERFETCH = 3;
/** bm25 weights: titles, the headings above, the text. */
const WEIGHTS = "10.0, 3.0, 1.0";

const SCHEMA = [
  "CREATE TABLE files (path TEXT PRIMARY KEY, stamp TEXT NOT NULL)",
  `CREATE TABLE units (id INTEGER PRIMARY KEY, path TEXT NOT NULL, ord INTEGER NOT NULL, outline_path TEXT NOT NULL,
    anchor_id TEXT, title TEXT NOT NULL, headings TEXT NOT NULL, text TEXT NOT NULL)`,
  "CREATE INDEX units_path ON units (path, ord)",
  `CREATE VIRTUAL TABLE units_fts USING fts5(title, headings, text, content='units', content_rowid='id',
    tokenize='porter unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER units_ai AFTER INSERT ON units BEGIN
    INSERT INTO units_fts(rowid, title, headings, text) VALUES (new.id, new.title, new.headings, new.text); END`,
  `CREATE TRIGGER units_ad AFTER DELETE ON units BEGIN
    INSERT INTO units_fts(units_fts, rowid, title, headings, text) VALUES ('delete', old.id, old.title, old.headings, old.text); END`,
];

/** Raised when this build's SQLite has no FTS5, so chat can't search. */
export class SearchUnavailableError extends Error {
  constructor(reason: string) {
    super(`Full-text search isn't available in this build of Specquer (${reason}).`);
  }
}

/** Where the index reads the files: the tree's Markdown files, their stamps and their text. */
export interface SearchSource {
  files(): Promise<string[]>;
  stamp(path: string): Promise<string | undefined>;
  read(path: string): Promise<string | undefined>;
}

/** A retrieved unit, with its text cut to its share of the budget if it was longer. */
export interface FoundUnit extends Omit<SearchUnit, "ord"> {
  path: string;
  cut: boolean;
}

export interface SearchOptions {
  /** The open document, whose units rank higher and whose first unit is always included. */
  openFile?: string;
  /** At most this many units. */
  units: number;
  /** Their budget, in estimated tokens. */
  contextTokens: number;
}

interface UnitRow {
  path: string;
  ord: number;
  outline_path: string;
  anchor_id: string | null;
  title: string;
  headings: string;
  text: string;
}

/** Whether this build's SQLite has FTS5. */
export function hasFts5(): boolean {
  const db = new Database(":memory:");
  try {
    db.run("CREATE VIRTUAL TABLE t USING fts5(x)");
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

export class SearchIndex {
  private db: Database | null = null;
  private updating: Promise<void> = Promise.resolve();
  /** Closed for good: nothing opens the database again, so no late update recreates the folder. */
  private closed = false;
  private readonly folder: string;
  private readonly file: string;

  constructor(
    root: string,
    private readonly source: SearchSource,
    private readonly now: () => number = Date.now,
    private readonly warn: (message: string) => void = (message) => console.warn(`specquer: ${message}`),
  ) {
    this.folder = join(root, CACHE_FOLDER);
    this.file = join(root, SEARCH_FILE);
  }

  /** Brings the index up to date with the files; runs one at a time. */
  update(): Promise<void> {
    const run = this.updating.then(() => this.sync());
    this.updating = run.catch((err) => this.warn(`updating the search index failed: ${(err as Error).message}`));
    return run;
  }

  /**
   * The units best matching `query` (an FTS5 query from `ftsQuery`, or `undefined` for none),
   * after bringing the index up to date: ranked with bm25, the open file's matches first (at most
   * half the units), its first unit always included, within the budget.
   */
  async search(query: string | undefined, options: SearchOptions): Promise<FoundUnit[]> {
    await this.update();
    const db = await this.open();
    const rows: Array<UnitRow & { score: number }> = [];
    if (query !== undefined) {
      const found = db
        .query<UnitRow & { score: number }, [string, number]>(
          `SELECT u.path, u.ord, u.outline_path, u.anchor_id, u.title, u.headings, u.text, bm25(units_fts, ${WEIGHTS}) AS score
           FROM units_fts JOIN units u ON u.id = units_fts.rowid WHERE units_fts MATCH ? ORDER BY score LIMIT ?`,
        )
        .all(query, options.units * OVERFETCH);
      // The open file's matches come first (R4.7), at most half the units, so it can't crowd out the rest
      const open = found.filter((row) => row.path === options.openFile).slice(0, Math.ceil(options.units / 2));
      rows.push(...open, ...found.filter((row) => !open.includes(row)));
    }
    if (options.openFile !== undefined && !rows.some((row) => row.path === options.openFile && row.ord === 0)) {
      const first = db
        .query<UnitRow, [string]>("SELECT path, ord, outline_path, anchor_id, title, headings, text FROM units WHERE path = ? ORDER BY ord LIMIT 1")
        .get(options.openFile);
      if (first !== null) rows.unshift({ ...first, score: -Infinity });
    }
    const share = Math.max(1, Math.floor(options.contextTokens / options.units));
    const units: FoundUnit[] = [];
    let tokens = 0;
    for (const row of rows) {
      if (units.length >= options.units) break;
      const cut = estimateTokens(row.text) > share;
      const text = cut ? row.text.slice(0, share * 4) : row.text;
      const cost = estimateTokens(`${row.headings} ${row.title} ${text}`);
      if (tokens + cost > options.contextTokens && units.length > 0) break;
      tokens += cost;
      units.push({
        path: row.path,
        outlinePath: row.outline_path,
        ...(row.anchor_id === null ? {} : { anchorId: row.anchor_id }),
        title: row.title,
        headings: row.headings === "" ? [] : row.headings.split("\n"),
        text,
        cut,
      });
    }
    return units;
  }

  private async sync(): Promise<void> {
    if (this.closed) return;
    const db = await this.open();
    const listed = await this.source.files();
    const wanted = new Set(listed);
    const known = new Map(db.query<{ path: string; stamp: string }, []>("SELECT path, stamp FROM files").all().map((row) => [row.path, row.stamp]));
    const remove = db.transaction((path: string) => {
      db.query("DELETE FROM units WHERE path = ?").run(path);
      db.query("DELETE FROM files WHERE path = ?").run(path);
    });
    for (const path of known.keys()) if (!wanted.has(path)) remove(path);
    const replace = db.transaction((path: string, stamp: string, units: SearchUnit[]) => {
      db.query("DELETE FROM units WHERE path = ?").run(path);
      const insert = db.query(
        "INSERT INTO units (path, ord, outline_path, anchor_id, title, headings, text) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const unit of units) insert.run(path, unit.ord, unit.outlinePath, unit.anchorId ?? null, unit.title, unit.headings.join("\n"), unit.text);
      db.query("INSERT OR REPLACE INTO files (path, stamp) VALUES (?, ?)").run(path, stamp);
    });
    // The stamps first, a few at a time (Step 014, R9.3); then the files that changed, in order
    const stamps = await mapLimit(listed, FILE_CALLS, (path) => this.source.stamp(path));
    for (const [i, path] of listed.entries()) {
      const stamp = stamps[i];
      if (stamp === undefined) {
        if (known.has(path)) remove(path);
        continue;
      }
      if (known.get(path) === stamp) continue;
      const text = await this.source.read(path);
      if (text === undefined) continue;
      replace(path, stamp, searchUnits(path, text));
    }
  }

  private async open(): Promise<Database> {
    if (this.closed) throw new Error("the search index is closed");
    if (this.db !== null) return this.db;
    if (!hasFts5()) throw new SearchUnavailableError("its SQLite has no FTS5");
    await ensureUserFolder(this.folder);
    try {
      this.db = this.connect();
    } catch (err) {
      // Damaged: keep it for inspection and start again; the index can always be rebuilt
      const aside = `${this.file}.damaged-${this.now()}`;
      this.warn(`${SEARCH_FILE} can't be read (${(err as Error).message}); moved to ${aside}`);
      await rename(this.file, aside);
      for (const suffix of ["-wal", "-shm"]) await rename(this.file + suffix, aside + suffix).catch(() => undefined);
      this.db = this.connect();
    }
    return this.db;
  }

  private connect(): Database {
    const db = new Database(this.file, { create: true });
    try {
      db.run("PRAGMA journal_mode = WAL");
      const { user_version } = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!;
      if (user_version !== SEARCH_SCHEMA_VERSION) {
        db.transaction(() => {
          for (const name of ["units_ai", "units_ad"]) db.run(`DROP TRIGGER IF EXISTS ${name}`);
          for (const name of ["units_fts", "units", "files"]) db.run(`DROP TABLE IF EXISTS ${name}`);
          for (const statement of SCHEMA) db.run(statement);
          db.run(`PRAGMA user_version = ${SEARCH_SCHEMA_VERSION}`);
        })();
      }
      db.query("SELECT count(*) FROM units_fts").get();
      return db;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  /** Closes the database for good, once an update under way has finished; later updates do nothing. */
  async close(): Promise<void> {
    this.closed = true;
    await this.updating;
    this.db?.close();
    this.db = null;
  }
}
