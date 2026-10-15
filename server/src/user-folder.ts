import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Creates `.specquer/user/` (or another per-user folder, such as `.specquer/cache/`) with a
 * `.gitignore` that keeps its contents out of Git. The `.gitignore` is written whenever it is
 * missing, not only when the folder is created: a folder that lost it (deleted by hand, or made
 * by something else) would otherwise let `git add -A` commit the session URL in `instance.json`,
 * the chat history or the specs' text in the caches. One that exists is left as it is.
 */
export async function ensureUserFolder(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  const gitignore = Bun.file(join(folder, ".gitignore"));
  if (!(await gitignore.exists())) await Bun.write(gitignore, "*\n");
}
