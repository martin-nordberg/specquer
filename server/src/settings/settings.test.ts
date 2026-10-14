import { afterEach, describe, expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { NVIDIA_BASE_URL } from "@specquer/shared/settings";
import { FileService } from "../files.ts";
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

const DOCS_CONFIG = "documentation/.specquer-config.yaml";
const DOCS_TEXT = `# The docs
folderType: BASELINE # sectioned
defaultPrefix: DOC
other: kept
`;

/** The folders the folder settings tests use. */
const FOLDERS = { [DOCS_CONFIG]: DOCS_TEXT, "documentation/notes/a.md": "", "documentation/specs/deep/a.md": "", "other/a.md": "" };

async function setup(files: Record<string, string>) {
  const temp = await tempRoot(files);
  cleanups.push(temp.cleanup);
  const queue = new WriteQueue();
  const read = (path: string) => Bun.file(join(temp.root, path)).text();
  const exists = (path: string) => Bun.file(join(temp.root, path)).exists();
  const environment = { keySet: (name: string) => name === "NVIDIA_API_KEY", status: async () => ({ enabled: false }) };
  return { root: temp.root, agent: new AgentSettingsFiles(temp.root, queue), folders: new FolderSettingsFile(new FileService(temp.root), queue), read, exists, environment };
}

describe("agent settings", () => {
  test("reads both files, the values in effect and their sources", async () => {
    const { agent, environment } = await setup({ [SHARED]: SHARED_TEXT, [PERSONAL]: "summaries:\n  concurrency: 4\n  tokenBudget: 5\n" });
    const settings = await agent.read(environment);
    expect(settings.shared.summaries).toEqual({ concurrency: 2, prefill: true });
    expect(settings.personal.summaries).toEqual({ concurrency: 4 });
    expect(settings.personal.warnings).toHaveLength(1);
    expect(settings.effective.summaries).toEqual({ concurrency: 4, tokenBudget: 24_000, prefill: true });
    expect(settings.sources).toEqual({
      model: "shared",
      summaries: { concurrency: "personal", tokenBudget: "default", prefill: "shared" },
      chat: { units: "default", contextTokens: "default", historyTurns: "default", historyTokens: "default", answerTokens: "default" },
    });
    expect(settings.keys).toEqual({ NVIDIA_API_KEY: true });
    expect(settings.personal.version).not.toBe("");
  });

  test("chat settings are read with their sources and written in their own block, removed when empty", async () => {
    const { agent, environment, read } = await setup({ [SHARED]: SHARED_TEXT });
    const { shared } = await agent.read(environment);
    expect((await agent.write({ scope: "shared", baseVersion: shared.version, chat: { units: 5, historyTurns: 2 } })).ok).toBe(true);
    expect(await read(SHARED)).toContain("chat:\n  units: 5\n  historyTurns: 2\n");
    const settings = await agent.read(environment);
    expect(settings.shared.chat).toEqual({ units: 5, historyTurns: 2 });
    expect(settings.effective.chat).toEqual({ units: 5, contextTokens: 12_000, historyTurns: 2, historyTokens: 8_000, answerTokens: 4_000 });
    expect(settings.sources.chat).toEqual({ units: "shared", contextTokens: "default", historyTurns: "shared", historyTokens: "default", answerTokens: "default" });
    const removed = await agent.write({ scope: "shared", baseVersion: settings.shared.version, chat: { units: null, historyTurns: null } });
    expect(removed.ok).toBe(true);
    expect(await read(SHARED)).not.toContain("chat:");
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
      chat: { units: "default", contextTokens: "default", historyTurns: "default", historyTokens: "default", answerTokens: "default" },
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
  test("reads a folder's own settings and what it inherits, key by key", async () => {
    const { folders } = await setup({ ...FOLDERS, "documentation/notes/.specquer-config.yaml": "folderType: AUXILIARY\n" });
    expect(await folders.read("documentation/notes")).toMatchObject({
      own: { folderType: "AUXILIARY", defaultPrefix: "inherit" },
      inherited: { folderType: { value: "BASELINE", from: "documentation" }, defaultPrefix: { value: "DOC", from: "documentation" } },
    });
    expect(await folders.read("documentation/specs/deep")).toMatchObject({
      version: "",
      own: { folderType: "inherit", defaultPrefix: "inherit" },
      inherited: { folderType: { value: "BASELINE", from: "documentation" } },
    });
    expect(await folders.read("other")).toMatchObject({ inherited: { folderType: { value: null, from: null }, defaultPrefix: { value: null, from: null } } });
    expect(await folders.read("")).toMatchObject({ inherited: { folderType: { value: null, from: null } } });
  });

  test("edits the keys in place, keeping comments and other keys", async () => {
    const { folders, read } = await setup(FOLDERS);
    const { version } = await folders.read("documentation");
    expect((await folders.write("documentation", { folderType: "CHANGE", defaultPrefix: "SPEC" }, version)).ok).toBe(true);
    expect(await read(DOCS_CONFIG)).toBe(DOCS_TEXT.replace("BASELINE #", "CHANGE #").replace(": DOC", ": SPEC"));
  });

  test("creates a folder's file when a value differs, and deletes it when nothing is left", async () => {
    const { folders, read, exists } = await setup(FOLDERS);
    const path = "documentation/notes/.specquer-config.yaml";
    expect(await folders.write("documentation/notes", { folderType: "inherit", defaultPrefix: "inherit" }, "")).toEqual({ ok: true, version: "" });
    expect(await exists(path)).toBe(false);
    expect((await folders.write("documentation/notes", { folderType: "NONSECTIONED", defaultPrefix: "inherit" }, "")).ok).toBe(true);
    const text = await read(path);
    expect(text).toStartWith("# Specquer's settings");
    expect(text).toEndWith("folderType: NONSECTIONED\n");
    const { version } = await folders.read("documentation/notes");
    expect(await folders.write("documentation/notes", { folderType: "inherit", defaultPrefix: "inherit" }, version)).toEqual({ ok: true, version: "" });
    expect(await exists(path)).toBe(false);
    // A file with other keys is kept
    const docs = await folders.read("documentation");
    await folders.write("documentation", { folderType: "inherit", defaultPrefix: "inherit" }, docs.version);
    expect(await read(DOCS_CONFIG)).toBe("# The docs\nother: kept\n");
  });

  test("a stale version is a conflict, and a broken file is never rewritten", async () => {
    const { folders, read, root } = await setup(FOLDERS);
    const { version } = await folders.read("documentation");
    await Bun.write(join(root, DOCS_CONFIG), "folderType: [\n");
    const setting = { folderType: "NONSECTIONED", defaultPrefix: "inherit" } as const;
    expect(await folders.write("documentation", setting, version)).toMatchObject({ ok: false, reason: "conflict" });
    const broken = await folders.read("documentation");
    expect(broken.error).toContain(DOCS_CONFIG);
    expect(await folders.write("documentation", setting, broken.version)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await read(DOCS_CONFIG)).toBe("folderType: [\n");
  });

  test("never reads or writes through a symbolic link, nor outside the root", async () => {
    const { folders, root } = await setup(FOLDERS);
    const outside = await tempRoot({ "x.yaml": "folderType: CHANGE\n" });
    cleanups.push(outside.cleanup);
    await symlink(join(outside.root, "x.yaml"), join(root, "other/.specquer-config.yaml"));
    await expect(folders.read("other")).rejects.toThrow("symbolic link");
    await symlink(outside.root, join(root, "linked"));
    await expect(folders.write("linked", { folderType: "CHANGE", defaultPrefix: "inherit" }, "")).rejects.toThrow("outside the root");
    expect(await Bun.file(join(outside.root, ".specquer-config.yaml")).exists()).toBe(false);
  });
});
