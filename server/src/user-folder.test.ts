import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { tempRoot } from "./test-support.ts";
import { ensureUserFolder } from "./user-folder.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("creates the folder with a .gitignore that ignores everything in it", async () => {
  const { root, cleanup } = await tempRoot();
  cleanups.push(cleanup);
  await ensureUserFolder(join(root, ".specquer", "user"));
  expect(await Bun.file(join(root, ".specquer/user/.gitignore")).text()).toBe("*\n");
});

test("puts back a missing .gitignore in a folder that already exists", async () => {
  const { root, cleanup } = await tempRoot({ ".specquer/user/instance.json": "{}", ".specquer/cache/search.db": "" });
  cleanups.push(cleanup);
  await ensureUserFolder(join(root, ".specquer", "user"));
  await ensureUserFolder(join(root, ".specquer", "cache"));
  expect(await Bun.file(join(root, ".specquer/user/.gitignore")).text()).toBe("*\n");
  expect(await Bun.file(join(root, ".specquer/cache/.gitignore")).text()).toBe("*\n");
});

test("leaves an existing .gitignore as it is", async () => {
  const { root, cleanup } = await tempRoot({ ".specquer/user/.gitignore": "*\n!keep.yaml\n" });
  cleanups.push(cleanup);
  await ensureUserFolder(join(root, ".specquer", "user"));
  expect(await Bun.file(join(root, ".specquer/user/.gitignore")).text()).toBe("*\n!keep.yaml\n");
});
