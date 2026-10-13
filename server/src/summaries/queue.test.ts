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

test("a running call runs to the end when its requests are aborted, and can be joined again", async () => {
  const queue = new CallQueue(() => 1);
  let calls = 0;
  let finished = false;
  const task = async () => {
    calls++;
    await Bun.sleep(30);
    finished = true;
    return "late";
  };
  const a = new AbortController();
  const first = queue.run("k", task, a.signal);
  await Bun.sleep(0);
  a.abort();
  await expect(first).rejects.toBeDefined();
  expect(queue.active).toBe(1);
  expect(await queue.run("k", task)).toBe("late");
  expect(finished).toBe(true);
  expect(calls).toBe(1);
});

test("interactive calls start before waiting background ones, which leave a slot free", async () => {
  const queue = new CallQueue(() => 2);
  const gates = Array.from({ length: 4 }, () => deferred<string>());
  const started: string[] = [];
  const run = (key: string, index: number, priority: "interactive" | "background") =>
    queue.run(
      key,
      () => {
        started.push(key);
        return gates[index]!.promise;
      },
      undefined,
      priority,
    );
  const backlog = [run("b0", 0, "background"), run("b1", 1, "background")];
  await Bun.sleep(0);
  // Background calls take at most concurrency - 1 slots
  expect(started).toEqual(["b0"]);
  expect(queue.waiting).toBe(1);
  const interactive = run("i", 2, "interactive");
  await Bun.sleep(0);
  expect(started).toEqual(["b0", "i"]);
  gates[2]!.resolve("i");
  expect(await interactive).toBe("i");
  gates[0]!.resolve("b0");
  await backlog[0];
  await Bun.sleep(0);
  expect(started).toEqual(["b0", "i", "b1"]);
  gates[1]!.resolve("b1");
  expect(await backlog[1]).toBe("b1");
});

test("an interactive request joining a waiting background call promotes it", async () => {
  const queue = new CallQueue(() => 2);
  const busy = deferred<string>();
  const started: string[] = [];
  const task = (key: string, value: Promise<string> | string) => () => {
    started.push(key);
    return Promise.resolve(value);
  };
  const running = queue.run("b0", task("b0", busy.promise), undefined, "background");
  const waiting = queue.run("b1", task("b1", "one"), undefined, "background");
  const other = queue.run("b2", task("b2", "two"), undefined, "background");
  await Bun.sleep(0);
  expect(started).toEqual(["b0"]);
  // Joined interactively: it starts in the free slot, ahead of b2
  expect(await queue.run("b1", task("b1", "one"))).toBe("one");
  expect(started).toEqual(["b0", "b1"]);
  busy.resolve("zero");
  expect(await Promise.all([running, waiting, other])).toEqual(["zero", "one", "two"]);
});

test("an abortable call is stopped when its last request is aborted, even once started (Step 010)", async () => {
  const queue = new CallQueue(() => 1);
  let taskSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const result = queue.run(
    "chat:1",
    (signal) => {
      taskSignal = signal;
      return new Promise<string>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    },
    controller.signal,
    "interactive",
    { abortable: true },
  );
  await Bun.sleep(0);
  expect(taskSignal?.aborted).toBe(false);
  controller.abort();
  await expect(result).rejects.toBeDefined();
  expect(taskSignal?.aborted).toBe(true);
  // Its slot is free again
  expect(await queue.run("k", async () => "next")).toBe("next");
});

test("a started call that isn't abortable runs to the end when its request is aborted", async () => {
  const queue = new CallQueue(() => 1);
  const gate = deferred<string>();
  let taskSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const result = queue.run(
    "summary",
    (signal) => {
      taskSignal = signal;
      return gate.promise;
    },
    controller.signal,
  );
  await Bun.sleep(0);
  controller.abort();
  await expect(result).rejects.toBeDefined();
  expect(taskSignal?.aborted).toBe(false);
  gate.resolve("done");
});

test("calls with unique keys are never shared", async () => {
  const queue = new CallQueue(() => 2);
  let calls = 0;
  const run = (key: string) => queue.run(key, async () => ++calls, undefined, "interactive", { abortable: true });
  expect(await Promise.all([run("chat:a"), run("chat:b")])).toEqual([1, 2]);
});
