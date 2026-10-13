import { Database } from "bun:sqlite";
import { readFileSync, rmSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ensureUserFolder } from "./user-folder.ts";

/**
 * One Specquer per root folder (Step 009). The first instance holds an exclusive SQLite lock on
 * `.specquer/user/instance.lock` for the life of its process, and writes its URL to
 * `instance.json`; a second launch finds the lock taken and hands the user over to the first.
 */

export const INSTANCE_LOCK = join(".specquer", "user", "instance.lock");
export const INSTANCE_FILE = join(".specquer", "user", "instance.json");

/** The exit code of a launch that found another instance on its root. */
export const ALREADY_RUNNING_EXIT = 3;

const instanceInfoSchema = z.object({
  pid: z.number().int(),
  port: z.number().int(),
  url: z.string(),
  root: z.string(),
  startedAt: z.string(),
});

export type InstanceInfo = z.infer<typeof instanceInfoSchema>;

export type InstanceLock =
  | { kind: "acquired"; lock: Database }
  | { kind: "taken"; info: InstanceInfo | undefined }
  | { kind: "unavailable"; problem: string };

/**
 * Takes the lock for `root`. The lock is an open `BEGIN EXCLUSIVE` transaction, so the returned
 * database must stay referenced and must never be written: a committed transaction doesn't keep
 * the lock. The operating system releases it when the process ends, however it ends.
 */
export async function acquireInstanceLock(root: string): Promise<InstanceLock> {
  const path = join(root, INSTANCE_LOCK);
  let db: Database;
  try {
    await ensureUserFolder(join(root, ".specquer", "user"));
    db = new Database(path, { create: true });
  } catch (err) {
    return { kind: "unavailable", problem: (err as Error).message };
  }
  try {
    db.run("PRAGMA busy_timeout = 0");
    db.run("PRAGMA locking_mode = EXCLUSIVE");
    db.run("BEGIN EXCLUSIVE");
    return { kind: "acquired", lock: db };
  } catch (err) {
    db.close();
    if ((err as { code?: string }).code === "SQLITE_BUSY") return { kind: "taken", info: await readInstanceInfo(root) };
    return { kind: "unavailable", problem: (err as Error).message };
  }
}

/** The running instance's file, or `undefined` when it is missing or invalid. */
export async function readInstanceInfo(root: string): Promise<InstanceInfo | undefined> {
  try {
    const parsed = instanceInfoSchema.safeParse(JSON.parse(await Bun.file(join(root, INSTANCE_FILE)).text()));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the instance file atomically, readable and writable by its owner only. */
export async function writeInstanceInfo(root: string, info: InstanceInfo): Promise<void> {
  const target = join(root, INSTANCE_FILE);
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/**
 * Deletes the instance file: unconditionally (a stale one), or only if it holds `pid`. Synchronous,
 * so it can run in an `exit` handler.
 */
export function removeInstanceInfo(root: string, pid?: number): void {
  const path = join(root, INSTANCE_FILE);
  if (pid !== undefined) {
    let info: InstanceInfo | undefined;
    try {
      const parsed = instanceInfoSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      info = parsed.success ? parsed.data : undefined;
    } catch {
      return;
    }
    if (info?.pid !== pid) return;
  }
  rmSync(path, { force: true });
}

export interface HandOverOptions {
  open: boolean;
  /** Whether `--port` was given, which a hand-over ignores. */
  portGiven: boolean;
}

export interface HandOverIo {
  print(line: string): void;
  warn(line: string): void;
  openBrowser(url: string): Promise<boolean>;
}

/**
 * Hands the user over to the instance already serving `root`: prints its URL in the same form as
 * a launch (`Open <url>`) and opens it. Resolves to the exit code.
 */
export async function handOver(root: string, info: InstanceInfo | undefined, options: HandOverOptions, io: HandOverIo): Promise<number> {
  if (info === undefined) {
    io.warn(`Specquer is already running on ${root}, but its URL isn't available yet (${join(root, INSTANCE_FILE)}). Try again in a moment.`);
    return ALREADY_RUNNING_EXIT;
  }
  io.print(`Specquer is already serving ${root}\nOpen ${info.url}`);
  if (options.portGiven) io.warn(`--port was ignored: the running instance uses port ${info.port}.`);
  if (options.open && !(await io.openBrowser(info.url))) io.warn("Couldn't open a browser; open the URL above by hand.");
  return ALREADY_RUNNING_EXIT;
}
