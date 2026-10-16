import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tempRoot } from "../test-support.ts";
import { CACHE_FILE, CACHE_FOLDER, SummaryCache } from "./cache.ts";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

const KEY = { text: "key", model: "model", promptVersion: 1 };
const VALUE = { summary: "A summary.", model: "Model", truncated: false };

test("a closed cache waits for an opening under way and never opens again, so its folder stays deleted", async () => {
  const temp = await tempRoot();
  cleanups.push(temp.cleanup);
  const cache = new SummaryCache(temp.root);
  const writing = cache.put(KEY, VALUE);
  await cache.close();
  await writing;
  await rm(join(temp.root, CACHE_FOLDER), { recursive: true, force: true });
  await cache.put(KEY, VALUE);
  expect(await cache.get(KEY)).toBeUndefined();
  expect(await Bun.file(join(temp.root, CACHE_FILE)).exists()).toBe(false);
});
