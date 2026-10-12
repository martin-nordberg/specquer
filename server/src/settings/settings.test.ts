import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { NVIDIA_BASE_URL } from "@specquer/shared/settings";
import { tempRoot } from "../test-support.ts";
import { AgentSettingsFiles } from "./agent-settings.ts";
import { FolderSettingsFile } from "./folder-settings.ts";
import { WriteQueue } from "./yaml-file.ts";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

const SHARED = ".specquer/shared/agent.config.yaml";
const PERSONAL = ".specquer/user/agent.config.yaml";
const PREFIXES = ".specquer/shared/section-prefixes.config.yaml";

const SHARED_TEXT = `# The model for agent features.
model:
  provider: nvidia
  name: google/gemma-4-31b-it # the default model
  baseUrl: https://integrate.api.nvidia.com/v1
  apiKeyEnv: NVIDIA_API_KEY
summaries:
  concurrency: 2
  prefill: true
future: kept
`;

const PREFIX_TEXT = `# Prefixes
prefixes:
  "./documentation/": DOC # the docs
  "documentation/notes/": NOTE
  "documentation/notes/ideas.md": IDEA
`;

async function setup(files: Record<string, string>) {
  const temp = await tempRoot(files);
  cleanups.push(temp.cleanup);
  const queue = new WriteQueue();
  const read = (path: string) => Bun.file(join(temp.root, path)).text();
  const exists = (path: string) => Bun.file(join(temp.root, path)).exists();
  const environment = { keySet: (name: string) => name === "NVIDIA_API_KEY", status: async () => ({ enabled: false }) };
  return { root: temp.root, agent: new AgentSettingsFiles(temp.root, queue), folders: new FolderSettingsFile(temp.root, queue), read, exists, environment };
}

describe("agent settings", () => {
  test("reads both files, the values in effect and their sources", async () => {
    const { agent, environment } = await setup({ [SHARED]: SHARED_TEXT, [PERSONAL]: "summaries:\n  concurrency: 4\n  tokenBudget: 5\n" });
    const settings = await agent.read(environment);
    expect(settings.shared.summaries).toEqual({ concurrency: 2, prefill: true });
    expect(settings.personal.summaries).toEqual({ concurrency: 4 });
    expect(settings.personal.warnings).toHaveLength(1);
    expect(settings.effective.summaries).toEqual({ concurrency: 4, tokenBudget: 24_000, prefill: true });
    expect(settings.sources).toEqual({ model: "shared", summaries: { concurrency: "personal", tokenBudget: "default", prefill: "shared" } });
    expect(settings.keys).toEqual({ NVIDIA_API_KEY: true });
    expect(settings.personal.version).not.toBe("");
  });

  test("changes only the values given, keeping comments, order and unknown keys", async () => {
    const { agent, environment, read } = await setup({ [SHARED]: SHARED_TEXT });
    const { shared } = await agent.read(environment);
    const result = await agent.write({ scope: "shared", baseVersion: shared.version, summaries: { concurrency: 3, prefill: null } });
    expect(result.ok).toBe(true);
    expect(await read(SHARED)).toBe(SHARED_TEXT.replace("concurrency: 2\n  prefill: true\n", "concurrency: 3\n"));
  });

  test("writes the whole model block, leaving unchanged values as they are", async () => {
    const { agent, environment, read } = await setup({ [SHARED]: SHARED_TEXT });
    const { shared } = await agent.read(environment);
    const model = { provider: "nvidia" as const, name: "other/model", baseUrl: NVIDIA_BASE_URL, apiKeyEnv: "NVIDIA_API_KEY" };
    expect((await agent.write({ scope: "shared", baseVersion: shared.version, model, summaries: {} })).ok).toBe(true);
    expect(await read(SHARED)).toBe(SHARED_TEXT.replace("google/gemma-4-31b-it", "other/model"));
  });

  test("creates the personal file, with its folder's .gitignore, and leaves the default URL out", async () => {
    const { agent, environment, read, exists } = await setup({ [SHARED]: SHARED_TEXT });
    const model = { provider: "nvidia" as const, name: "mine/model", baseUrl: NVIDIA_BASE_URL, apiKeyEnv: "MY_KEY" };
    const result = await agent.write({ scope: "personal", baseVersion: "", model, summaries: { prefill: false } });
    expect(result.ok).toBe(true);
    const text = await read(PERSONAL);
    expect(text).toStartWith("# Personal agent settings");
    expect(text).toContain("model:\n  provider: nvidia\n  name: mine/model\n  apiKeyEnv: MY_KEY\nsummaries:\n  prefill: false\n");
    expect(await read(".specquer/user/.gitignore")).toBe("*\n");
    const settings = await agent.read(environment);
    expect(settings.sources.model).toBe("personal");
    expect(settings.keys).toEqual({ NVIDIA_API_KEY: true, MY_KEY: false });
    // Removing everything again leaves an empty mapping, not a broken file
    const removed = await agent.write({ scope: "personal", baseVersion: settings.personal.version, model: null, summaries: { prefill: null } });
    expect(removed.ok).toBe(true);
    expect(exists(PERSONAL)).resolves.toBe(true);
    expect((await agent.read(environment)).sources).toEqual({
      model: "shared",
      summaries: { concurrency: "shared", tokenBudget: "default", prefill: "shared" },
    });
  });

  test("a save with nothing to write creates no file", async () => {
    const { agent, exists } = await setup({});
    expect(await agent.write({ scope: "personal", baseVersion: "", summaries: { prefill: null } })).toEqual({ ok: true, version: "" });
    expect(await exists(PERSONAL)).toBe(false);
  });

  test("a stale version is a conflict, and nothing is written", async () => {
    const { agent, environment, read, root } = await setup({ [SHARED]: SHARED_TEXT });
    const { shared } = await agent.read(environment);
    await Bun.write(join(root, SHARED), `${SHARED_TEXT}# edited by hand\n`);
    const result = await agent.write({ scope: "shared", baseVersion: shared.version, summaries: { concurrency: 5 } });
    expect(result).toMatchObject({ ok: false, reason: "conflict" });
    expect(await read(SHARED)).toEndWith("# edited by hand\n");
  });

  test("a file that isn't valid YAML is reported and never rewritten", async () => {
    const broken = "model: [\n";
    const { agent, environment, read } = await setup({ [SHARED]: broken });
    const { shared } = await agent.read(environment);
    expect(shared.error).toContain(SHARED);
    const result = await agent.write({ scope: "shared", baseVersion: shared.version, summaries: { concurrency: 5 } });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(await read(SHARED)).toBe(broken);
  });

  test("an unchanged save keeps the version and the file", async () => {
    const { agent, environment, read } = await setup({ [SHARED]: SHARED_TEXT });
    const { shared } = await agent.read(environment);
    expect(await agent.write({ scope: "shared", baseVersion: shared.version, summaries: { concurrency: 2 } })).toEqual({ ok: true, version: shared.version });
    expect(await read(SHARED)).toBe(SHARED_TEXT);
  });
});

describe("folder settings", () => {
  test("reads a folder's own entry, what it inherits and the file keys in it", async () => {
    const { folders } = await setup({ [PREFIXES]: PREFIX_TEXT });
    expect(await folders.read("documentation/notes")).toMatchObject({
      own: { kind: "prefix", prefix: "NOTE" },
      inherited: { from: "documentation", prefix: "DOC" },
      fileKeys: [{ path: "documentation/notes/ideas.md", prefix: "IDEA" }],
    });
    expect(await folders.read("documentation/specs")).toMatchObject({ own: { kind: "inherit" }, inherited: { from: "documentation", prefix: "DOC" } });
    expect(await folders.read("other")).toMatchObject({ own: { kind: "inherit" }, inherited: null, fileKeys: [] });
  });

  test("edits a key in place, whatever its spelling, keeping comments", async () => {
    const { folders, read } = await setup({ [PREFIXES]: PREFIX_TEXT });
    const { version } = await folders.read("documentation");
    expect((await folders.write("documentation", { kind: "prefix", prefix: "SPEC" }, version)).ok).toBe(true);
    expect(await read(PREFIXES)).toBe(PREFIX_TEXT.replace(": DOC #", ": SPEC #"));
  });

  test("writes null for not sectioned, adds new keys at the end and removes them again", async () => {
    const { folders, read } = await setup({ [PREFIXES]: PREFIX_TEXT });
    let { version } = await folders.read("documentation/archive");
    let result = await folders.write("documentation/archive", { kind: "off" }, version);
    expect(result.ok).toBe(true);
    expect(await read(PREFIXES)).toBe(`${PREFIX_TEXT}  "documentation/archive/": null\n`);
    expect(await folders.read("documentation/archive")).toMatchObject({ own: { kind: "off" } });
    expect(await folders.read("documentation/archive/deep")).toMatchObject({ inherited: { from: "documentation/archive", prefix: null } });
    version = (await folders.read("documentation/archive")).version;
    result = await folders.write("documentation/archive", { kind: "inherit" }, version);
    expect(result.ok).toBe(true);
    expect(await read(PREFIXES)).toBe(PREFIX_TEXT);
    version = (await folders.read("documentation/notes")).version;
    await folders.write("documentation/notes", { kind: "off" }, version);
    expect(await read(PREFIXES)).toContain('"documentation/notes/": null\n');
  });

  test("the root folder's key is ./", async () => {
    const { folders, read } = await setup({ [PREFIXES]: PREFIX_TEXT });
    const { version } = await folders.read("");
    await folders.write("", { kind: "prefix", prefix: "TOP" }, version);
    expect(await read(PREFIXES)).toEndWith('  "./": TOP\n');
    expect(await folders.read("")).toMatchObject({ own: { kind: "prefix", prefix: "TOP" }, inherited: null });
  });

  test("creates the file when there is none", async () => {
    const { folders, read } = await setup({});
    const settings = await folders.read("docs");
    expect(settings).toMatchObject({ version: "", own: { kind: "inherit" }, inherited: null });
    expect(await folders.write("docs", { kind: "prefix", prefix: "REQ" }, "")).toMatchObject({ ok: true });
    const text = await read(PREFIXES);
    expect(text).toStartWith("# Section prefixes");
    expect(text).toContain('prefixes:\n  "docs/": REQ\n');
  });

  test("a stale version is a conflict, and a broken file is never rewritten", async () => {
    const { folders, read, root } = await setup({ [PREFIXES]: PREFIX_TEXT });
    const { version } = await folders.read("docs");
    await Bun.write(join(root, PREFIXES), "prefixes: [\n");
    expect(await folders.write("docs", { kind: "off" }, version)).toMatchObject({ ok: false, reason: "conflict" });
    const broken = await folders.read("docs");
    expect(broken.error).toContain(PREFIXES);
    expect(await folders.write("docs", { kind: "off" }, broken.version)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await read(PREFIXES)).toBe("prefixes: [\n");
  });
});
