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
 * Markdown files and folder configuration files (`.specquer-config.yaml`) Git doesn't ignore
 * (tracked, or untracked and not ignored), relative to the root, and the files of `.specquer`
 * folders, which reveal nested Specquer folders (their `shared/` data is committed).
 */
export async function gitMarkdownFiles(root: string): Promise<string[] | null> {
  const result = await $`git -C ${root} ls-files -z --cached --others --exclude-standard -- ${":(icase)*.md"} ${":(glob)**/.specquer-config.yaml"} ${":(glob)**/.specquer/**"}`
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) return null;
  return [...new Set(result.stdout.toString().split("\0").filter((p) => p !== ""))];
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
