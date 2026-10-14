import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_STATUS_VALUES } from "@specquer/shared/sections";
import { tempRoot } from "../test-support.ts";
import { PrefixConfigs, parsePrefixConfig } from "./prefix-config.ts";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

test("a good file gives its statuses, trimmed, in order", () => {
  expect(parsePrefixConfig("# Ours\nstatusValues:\n  - Proposed\n  - ' In Review '\n  - Done, really\nother: 1\n")).toEqual({
    statusValues: ["Proposed", "In Review", "Done, really"],
  });
});

test("each kind of unusable file", () => {
  const problem = (text: string) => {
    const parsed = parsePrefixConfig(text);
    return "problem" in parsed ? parsed.problem : undefined;
  };
  expect(problem("statusValues: [Draft\n")).toBe("unparsable");
  expect(problem("")).toBe("missing-list");
  expect(problem("statusValues: Draft,Approved\n")).toBe("missing-list");
  expect(problem("status-values:\n  - Draft\n")).toBe("missing-list");
  expect(problem("statusValues: []\n")).toBe("empty-list");
  expect(problem("statusValues:\n  - Draft\n  - 3\n")).toBe("bad-value");
  expect(problem("statusValues:\n  - Draft\n  - ''\n")).toBe("bad-value");
  expect(problem("statusValues:\n  - 'Say \"hi\"'\n")).toBe("bad-value");
  expect(problem("statusValues:\n  - Draft\n  - [a]\n")).toBe("bad-value");
  expect(problem("statusValues:\n  - Draft\n  - ' draft'\n")).toBe("repeated-value");
});

test("the reader uses the defaults without a usable file, reports it, and reads a changed file again", async () => {
  const temp = await tempRoot({
    ".specquer/shared/REQ/prefix.config.yaml": "statusValues:\n  - Proposed\n  - Done\n",
    ".specquer/shared/SPEC/prefix.config.yaml": "statusValues: []\n",
    ".specquer/shared/WORK/sections.yaml": "lastSequence: 0\n",
  });
  cleanups.push(temp.cleanup);
  const warnings: string[] = [];
  const configs = new PrefixConfigs(temp.root, (message) => warnings.push(message));
  let settings = await configs.load();
  expect(settings.allowed("REQ")).toEqual(["Proposed", "Done"]);
  expect(settings.allowed("SPEC")).toEqual(DEFAULT_STATUS_VALUES);
  expect(settings.allowed("WORK")).toEqual(DEFAULT_STATUS_VALUES);
  expect(settings.allowed(undefined)).toEqual(DEFAULT_STATUS_VALUES);
  expect(settings.statusValues()).toEqual({ REQ: ["Proposed", "Done"] });
  expect(settings.problems()).toEqual([
    { kind: "prefix-config", prefix: "SPEC", path: ".specquer/shared/SPEC/prefix.config.yaml", problem: "empty-list", message: "its list of statusValues is empty" },
  ]);
  expect(warnings).toEqual([".specquer/shared/SPEC/prefix.config.yaml: its list of statusValues is empty; SPEC uses the default statuses"]);
  // Unchanged files aren't read again, so the same settings come back
  expect(await configs.load()).toBe(settings);
  await Bun.write(join(temp.root, ".specquer/shared/SPEC/prefix.config.yaml"), "statusValues:\n  - Open\n  - Closed\n");
  settings = await configs.load();
  expect(settings.allowed("SPEC")).toEqual(["Open", "Closed"]);
  expect(settings.problems()).toEqual([]);
  expect(warnings.length).toBe(1);
});
