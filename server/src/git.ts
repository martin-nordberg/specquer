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

/** Markdown files Git doesn't ignore (tracked, or untracked and not ignored), relative to the root. */
export async function gitMarkdownFiles(root: string): Promise<string[] | null> {
  const result = await $`git -C ${root} ls-files -z --cached --others --exclude-standard -- ${":(icase)*.md"}`
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) return null;
  return [...new Set(result.stdout.toString().split("\0").filter((p) => p !== ""))];
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
