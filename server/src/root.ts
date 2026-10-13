import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { gitTopLevel } from "./git.ts";

/**
 * Finding the Specquer folder a launch belongs to (Step 009, nested Specquer folders): the given
 * folder, or the one folder above it holding `.specquer/`. Two or more `.specquer/` folders on the
 * way up are nested, and Specquer refuses to run.
 */

/** The exit code of a launch inside a nested Specquer folder. */
export const NESTED_SPECQUER_EXIT = 4;

export type SpecquerRoot =
  | { kind: "given"; root: string }
  | { kind: "parent"; root: string; given: string }
  | { kind: "nested"; folders: string[] };

export interface FindRootOptions {
  /**
   * The last folder searched: the Git work tree's top level, or `null` to go up to the root of
   * the file system (outside Git). Defaults to asking Git.
   */
  top?: string | null;
  /** Whether a folder holds a `.specquer` folder; a symbolic link to a folder counts. */
  hasSpecquer?: (folder: string) => Promise<boolean>;
}

async function holdsSpecquerFolder(folder: string): Promise<boolean> {
  try {
    return (await stat(join(folder, ".specquer"))).isDirectory();
  } catch {
    return false;
  }
}

function isSameOrBelow(folder: string, top: string): boolean {
  const path = relative(top, folder);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/**
 * Searches `given` (a real path) and each folder above it for `.specquer/`, stopping at the Git
 * work tree's top level when `given` is in one (decision D1).
 */
export async function findSpecquerRoot(given: string, options: FindRootOptions = {}): Promise<SpecquerRoot> {
  const top = options.top === undefined ? await gitTopLevel(given) : options.top;
  const hasSpecquer = options.hasSpecquer ?? holdsSpecquerFolder;
  const found: string[] = [];
  let folder = given;
  for (;;) {
    if (await hasSpecquer(folder)) found.push(folder);
    if (top !== null && !isSameOrBelow(dirname(folder), top)) break;
    const parent = dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
  if (found.length >= 2) return { kind: "nested", folders: found.map((f) => join(f, ".specquer")) };
  if (found.length === 1 && found[0] !== given) return { kind: "parent", root: found[0]!, given };
  return { kind: "given", root: given };
}
