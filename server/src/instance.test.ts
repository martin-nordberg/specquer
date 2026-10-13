import type { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ALREADY_RUNNING_EXIT,
  INSTANCE_FILE,
  type InstanceInfo,
  acquireInstanceLock,
  handOver,
  readInstanceInfo,
  removeInstanceInfo,
  writeInstanceInfo,
} from "./instance.ts";
import { tempRoot } from "./test-support.ts";

const roots: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const cleanup of roots) await cleanup();
});

async function newRoot() {
  const { root, cleanup } = await tempRoot();
  roots.push(cleanup);
  return root;
}

const held: Database[] = [];
afterEach(() => {
  for (const db of held.splice(0)) db.close();
});

/** A child process holding the lock on `root`, until it is killed. */
async function holdInChild(root: string) {
  const child = Bun.spawn(
    ["bun", "-e", `const { acquireInstanceLock } = await import(${JSON.stringify(join(import.meta.dir, "instance.ts"))}); const lock = await acquireInstanceLock(${JSON.stringify(root)}); console.log(lock.kind); globalThis.lock = lock; await Bun.sleep(60_000);`],
    { stdout: "pipe", stderr: "inherit" },
  );
  const reader = child.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(value).trim()).toBe("acquired");
  return child;
}

const info = (root: string, pid = 4242): InstanceInfo => ({
  pid,
  port: 4870,
  url: "http://127.0.0.1:4870/?token=abc",
  root,
  startedAt: "2026-10-13T12:00:00.000Z",
});

describe("the instance lock", () => {
  test("is taken once; a second attempt in the same process finds it taken", async () => {
    const root = await newRoot();
    const first = await acquireInstanceLock(root);
    expect(first.kind).toBe("acquired");
    if (first.kind === "acquired") held.push(first.lock);
    expect((await acquireInstanceLock(root)).kind).toBe("taken");
  });

  test("held by another process, it is taken, with that process's instance file", async () => {
    const root = await newRoot();
    const child = await holdInChild(root);
    try {
      await writeInstanceInfo(root, info(root, child.pid));
      const lock = await acquireInstanceLock(root);
      expect(lock).toEqual({ kind: "taken", info: info(root, child.pid) });
    } finally {
      child.kill();
      await child.exited;
    }
  });

  test("is free again once the process holding it is killed", async () => {
    const root = await newRoot();
    const child = await holdInChild(root);
    child.kill("SIGKILL");
    await child.exited;
    const lock = await acquireInstanceLock(root);
    expect(lock.kind).toBe("acquired");
    if (lock.kind === "acquired") held.push(lock.lock);
  });

  test("is unavailable when the user folder can't be written", async () => {
    if (process.getuid?.() === 0) return; // root ignores the mode
    const root = await newRoot();
    const user = join(root, ".specquer", "user");
    await mkdir(user, { recursive: true });
    await chmod(user, 0o500);
    try {
      expect((await acquireInstanceLock(root)).kind).toBe("unavailable");
    } finally {
      await chmod(user, 0o700);
    }
  });
});

describe("the instance file", () => {
  test("is written for the owner only, and read back", async () => {
    const root = await newRoot();
    await mkdir(join(root, ".specquer", "user"), { recursive: true });
    await writeInstanceInfo(root, info(root));
    expect(await readInstanceInfo(root)).toEqual(info(root));
    if (process.platform !== "win32") expect((await stat(join(root, INSTANCE_FILE))).mode & 0o777).toBe(0o600);
  });

  test("missing or invalid, it reads as undefined", async () => {
    const root = await newRoot();
    expect(await readInstanceInfo(root)).toBeUndefined();
    await Bun.write(join(root, INSTANCE_FILE), '{ "pid": "x" }');
    expect(await readInstanceInfo(root)).toBeUndefined();
    await Bun.write(join(root, INSTANCE_FILE), "not json");
    expect(await readInstanceInfo(root)).toBeUndefined();
  });

  test("is removed only by the process it names, or unconditionally when stale", async () => {
    const root = await newRoot();
    await mkdir(join(root, ".specquer", "user"), { recursive: true });
    await writeInstanceInfo(root, info(root, 4242));
    removeInstanceInfo(root, 1);
    expect(await readInstanceInfo(root)).toEqual(info(root, 4242));
    removeInstanceInfo(root, 4242);
    expect(await readInstanceInfo(root)).toBeUndefined();
    await writeInstanceInfo(root, info(root, 4242));
    removeInstanceInfo(root);
    expect(await Bun.file(join(root, INSTANCE_FILE)).exists()).toBe(false);
  });
});

describe("handing over", () => {
  function io(opened = true) {
    const out = { printed: [] as string[], warned: [] as string[], opened: [] as string[] };
    return {
      out,
      io: {
        print: (line: string) => out.printed.push(line),
        warn: (line: string) => out.warned.push(line),
        openBrowser: async (url: string) => {
          out.opened.push(url);
          return opened;
        },
      },
    };
  }

  test("prints the running instance's URL as a launch does, opens it and exits with 3", async () => {
    const { out, io: handlers } = io();
    const code = await handOver("/r", info("/r"), { open: true, portGiven: false }, handlers);
    expect(code).toBe(ALREADY_RUNNING_EXIT);
    expect(out.printed.join("\n")).toBe("Specquer is already serving /r\nOpen http://127.0.0.1:4870/?token=abc");
    expect(out.opened).toEqual(["http://127.0.0.1:4870/?token=abc"]);
    expect(out.warned).toEqual([]);
  });

  test("with --no-open it opens nothing; with --port it says the port was ignored", async () => {
    const { out, io: handlers } = io();
    await handOver("/r", info("/r"), { open: false, portGiven: true }, handlers);
    expect(out.opened).toEqual([]);
    expect(out.warned).toEqual(["--port was ignored: the running instance uses port 4870."]);
  });

  test("without the instance file it says Specquer is running, opens nothing and exits with 3", async () => {
    const { out, io: handlers } = io();
    const code = await handOver("/r", undefined, { open: true, portGiven: false }, handlers);
    expect(code).toBe(ALREADY_RUNNING_EXIT);
    expect(out.printed).toEqual([]);
    expect(out.opened).toEqual([]);
    expect(out.warned[0]).toContain("already running on /r");
  });
});
