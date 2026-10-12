import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Creates `.specquer/user/` (or another per-user folder) with a `.gitignore` that keeps per-user
 * state out of Git.
 */
export async function ensureUserFolder(folder: string): Promise<void> {
  const created = await mkdir(folder, { recursive: true });
  // mkdir returns the first folder it created, or undefined if the folder already existed
  if (created === undefined) return;
  const gitignore = Bun.file(join(folder, ".gitignore"));
  if (!(await gitignore.exists())) await Bun.write(gitignore, "*\n");
}
