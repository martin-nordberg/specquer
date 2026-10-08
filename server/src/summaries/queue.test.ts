import { expect, test } from "bun:test";
import { CallQueue } from "./queue.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

test("limits how many calls run at once", async () => {
  const queue = new CallQueue(() => 2);
  const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
  const started: number[] = [];
  const results = gates.map((gate, i) =>
    queue.run(`k${i}`, () => {
      started.push(i);
      return gate.promise;
    }),
  );
  await Bun.sleep(0);
  expect(started).toEqual([0, 1]);
  expect(queue.active).toBe(2);
  gates[0]!.resolve("a");
  await results[0];
  await Bun.sleep(0);
  expect(started).toEqual([0, 1, 2]);
  gates[1]!.resolve("b");
  gates[2]!.resolve("c");
  expect(await Promise.all(results)).toEqual(["a", "b", "c"]);
});

test("identical requests share one call", async () => {
  const queue = new CallQueue(() => 2);
  let calls = 0;
  const task = async () => {
    calls++;
    await Bun.sleep(5);
    return "shared";
  };
  expect(await Promise.all([queue.run("k", task), queue.run("k", task)])).toEqual(["shared", "shared"]);
  expect(calls).toBe(1);
  // Once done, the next request calls again
  await queue.run("k", task);
  expect(calls).toBe(2);
});

test("a call whose requests were all aborted is dropped before it starts", async () => {
  const queue = new CallQueue(() => 1);
  const gate = deferred<string>();
  const first = queue.run("busy", () => gate.promise);
  const controller = new AbortController();
  let ran = false;
  const second = queue.run(
    "dropped",
    async () => {
      ran = true;
      return "x";
    },
    controller.signal,
  );
  controller.abort(new DOMException("No longer needed", "AbortError"));
  await expect(second).rejects.toThrow("No longer needed");
  gate.resolve("done");
  await first;
  await Bun.sleep(0);
  expect(ran).toBe(false);
});

test("a running call is aborted only when every request for it is", async () => {
  const queue = new CallQueue(() => 1);
  let callSignal: AbortSignal | undefined;
  const task = (signal: AbortSignal) => {
    callSignal = signal;
    return new Promise<string>((resolve) => setTimeout(() => resolve("late"), 30));
  };
  const a = new AbortController();
  const b = new AbortController();
  const first = queue.run("k", task, a.signal);
  const second = queue.run("k", task, b.signal);
  await Bun.sleep(0);
  a.abort();
  await expect(first).rejects.toBeDefined();
  expect(callSignal?.aborted).toBe(false);
  b.abort();
  await expect(second).rejects.toBeDefined();
  expect(callSignal?.aborted).toBe(true);
});
