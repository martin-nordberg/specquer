import { expect, test } from "bun:test";
import { mapLimit } from "./limit.ts";

test("mapLimit keeps the order and runs at most the limit at once", async () => {
  let running = 0;
  let most = 0;
  const results = await mapLimit([5, 1, 4, 2, 3], 2, async (n, i) => {
    running++;
    most = Math.max(most, running);
    await Bun.sleep(n);
    running--;
    return `${i}:${n}`;
  });
  expect(results).toEqual(["0:5", "1:1", "2:4", "3:2", "4:3"]);
  expect(most).toBe(2);
  expect(await mapLimit([], 4, async () => 1)).toEqual([]);
});
