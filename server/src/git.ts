import { userInfo } from "node:os";
import { $ } from "bun";

/** Git queries used by the file service. All return `null` when the folder isn't in a Git work tree. */

export interface GitInfo {
  /** The root folder's path relative to the repository's top level, ending in `/` (or ""). */
  prefix: string;
}

export async function gitInfo(root: string): Promise<GitInfo | null> {
  try {
    const result = await $`git -C ${root} rev-parse --is-inside-work-tree --show-prefix`.quiet().nothrow();
    if (result.exitCode !== 0) return null;
    const [inside, prefix = ""] = result.stdout.toString().split("\n");
    return inside === "true" ? { prefix } : null;
  } catch {
    // Git isn't installed
    return null;
  }
}

/** The top level of the Git work tree holding `folder` (an absolute path), or `null` outside one. */
export async function gitTopLevel(folder: string): Promise<string | null> {
  try {
    const result = await $`git -C ${folder} rev-parse --show-toplevel`.quiet().nothrow();
    if (result.exitCode !== 0) return null;
    return result.stdout.toString().trim() || null;
  } catch {
    // Git isn't installed
    return null;
  }
}

/**
 * The name recorded for the user (Step 012, R2.4): Git's `user.name` for the root folder, else
 * its `user.email`, else the operating system's login name.
 */
export async function gitUserName(root: string): Promise<string> {
  for (const key of ["user.name", "user.email"]) {
    try {
      const result = await $`git -C ${root} config ${key}`.quiet().nothrow();
      const value = result.exitCode === 0 ? result.stdout.toString().trim() : "";
      if (value !== "") return value;
    } catch {
      // Git isn't installed
      break;
    }
  }
  try {
    return userInfo().username || "unknown";
  } catch {
    return "unknown";
  }
}

/** What Git lists of a work tree's files (`gitListedFiles`). */
export interface GitListing {
  /** Tracked files still on disk, and untracked files Git doesn't ignore, relative to the root. */
  files: string[];
  /** The listed files that Git tracks as symbolic links, which may lead to folders. */
  links: Set<string>;
}

/**
 * Every file Git doesn't ignore (tracked, or untracked and not ignored), relative to the root,
 * without tracked files deleted from disk and without submodules (Step 014, R9.3: Git says which
 * files are gone, so they needn't be `stat`ed one by one).
 */
export async function gitListedFiles(root: string): Promise<GitListing | null> {
  try {
    const [cached, others, deleted] = await Promise.all([
      $`git -C ${root} ls-files -z --cached --stage`.quiet().nothrow(),
      $`git -C ${root} ls-files -z --others --exclude-standard`.quiet().nothrow(),
      $`git -C ${root} ls-files -z --deleted`.quiet().nothrow(),
    ]);
    if (cached.exitCode !== 0 || others.exitCode !== 0 || deleted.exitCode !== 0) return null;
    const gone = new Set(split(deleted.stdout.toString()));
    const files = new Set<string>();
    const links = new Set<string>();
    // `<mode> <object> <stage>\t<path>`; a file with merge conflicts is listed once per stage
    for (const entry of split(cached.stdout.toString())) {
      const tab = entry.indexOf("\t");
      const mode = entry.slice(0, entry.indexOf(" "));
      const path = entry.slice(tab + 1);
      if (tab < 0 || mode === "160000" || gone.has(path)) continue;
      files.add(path);
      if (mode === "120000") links.add(path);
    }
    for (const path of split(others.stdout.toString())) files.add(path);
    return { files: [...files], links };
  } catch {
    // Git isn't installed
    return null;
  }
}

function split(output: string): string[] {
  return output.split("\0").filter((p) => p !== "");
}

/**
 * Untracked folders Git doesn't ignore, relative to the root and without the trailing slash. Git
 * lists a folder with no tracked files as one entry instead of its contents, empty ones included.
 */
export async function gitUntrackedFolders(root: string): Promise<string[] | null> {
  const result = await $`git -C ${root} ls-files -z --others --exclude-standard --directory`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  return result.stdout
    .toString()
    .split("\0")
    .filter((p) => p.endsWith("/"))
    .map((p) => p.slice(0, -1));
}

/**
 * Files under `path` (relative to the root) that aren't committed: new, modified, deleted or
 * ignored. Paths are relative to the root.
 */
export async function gitUncommitted(root: string, info: GitInfo, path: string): Promise<string[]> {
  const result = await $`git -C ${root} status --porcelain=v1 -z --untracked-files=all --ignored=matching -- ${path}`
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) return [];
  const fields = result.stdout.toString().split("\0");
  const files: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (field.length < 4) continue;
    const status = field.slice(0, 2);
    const repoPath = field.slice(3);
    // Renames and copies are followed by the original path
    if (status.includes("R") || status.includes("C")) i++;
    if (repoPath.startsWith(info.prefix)) files.push(repoPath.slice(info.prefix.length));
  }
  return files;
}

/**
 * Which of the given paths (relative to the root) Git's index tracks, or `null` when the root
 * isn't in a Git work tree. Used to tell an original from a copy made outside Specquer.
 */
export async function gitTrackedFiles(root: string, paths: readonly string[]): Promise<string[] | null> {
  try {
    const result = await $`git --literal-pathspecs -C ${root} ls-files -z --cached -- ${paths}`.quiet().nothrow();
    if (result.exitCode !== 0) return null;
    return result.stdout
      .toString()
      .split("\0")
      .filter((path) => path !== "");
  } catch {
    // Git isn't installed
    return null;
  }
}
