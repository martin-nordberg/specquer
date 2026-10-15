import { afterEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type ChatModel, MODEL_TEST_PROMPT, createChatModel } from "@specquer/agent";
import type { AgentSettings, FolderSettings, ModelTestResult, SectionInfo } from "@specquer/shared/api";
import { findSections } from "@specquer/shared/markdown";
import { NVIDIA_BASE_URL } from "@specquer/shared/settings";
import { TEST_APPROVALS, tempRoot, testApp } from "../test-support.ts";

let cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

const SHARED = ".specquer/shared/agent.config.yaml";
const PERSONAL = ".specquer/user/agent.config.yaml";
const DOCS_CONFIG = "docs/.specquer-config.yaml";
const ARCHIVE_CONFIG = "docs/archive/.specquer-config.yaml";
const OFF = { folderType: "NONSECTIONED", defaultPrefix: "inherit" } as const;
const INHERIT = { folderType: "inherit", defaultPrefix: "inherit" } as const;
const CONFIG = "model:\n  provider: nvidia\n  name: test/model\n  apiKeyEnv: TEST_KEY\nsummaries:\n  concurrency: 2\n";
const MODEL = { provider: "nvidia" as const, name: "test/model", baseUrl: NVIDIA_BASE_URL, apiKeyEnv: "TEST_KEY" };

type Invoke = (prompt: string, signal: AbortSignal | undefined) => Promise<string>;

async function setup(files: Record<string, string> = {}, invoke: Invoke = async () => "OK") {
  const temp = await tempRoot({ [SHARED]: CONFIG, ...TEST_APPROVALS, [DOCS_CONFIG]: "folderType: BASELINE\ndefaultPrefix: REQ\n", ...files });
  cleanups.push(temp.cleanup);
  const prompts: string[] = [];
  const model = {
    async invoke(messages: Array<{ content: unknown }>, options?: { signal?: AbortSignal }) {
      const prompt = String(messages.at(-1)?.content);
      prompts.push(prompt);
      return { content: await invoke(prompt, options?.signal) };
    },
  } as unknown as ChatModel;
  const app = testApp(temp.root, undefined, {
    env: { TEST_KEY: "secret-key-value" },
    createModel: (config, env, options) => {
      const real = createChatModel(config, env, options);
      return real.ok ? { ...real, model } : real;
    },
    warn: () => {},
  });
  cleanups.push(() => app.summaries.close());
  const read = (path: string) => Bun.file(join(temp.root, path)).text();
  const json = async <T>(path: string, init?: Parameters<typeof app.request>[1]) => {
    const res = await app.request(path, init);
    return { status: res.status, body: (await res.json()) as T };
  };
  return { root: temp.root, ...app, prompts, read, json };
}

describe("agent settings routes", () => {
  test("a personal model takes effect at once and leaves the shared file alone", async () => {
    const { json, read } = await setup();
    const before = await json<AgentSettings>("/api/settings/agent");
    expect(before.body.effective.model?.name).toBe("test/model");
    expect(before.body.keys).toEqual({ TEST_KEY: true });
    expect(before.body.status.model).toBe("test/model");
    const saved = await json<{ version: string }>("/api/settings/agent", {
      method: "PUT",
      body: { scope: "personal", baseVersion: before.body.personal.version, model: { ...MODEL, name: "other/model" } },
    });
    expect(saved.status).toBe(200);
    const after = await json<AgentSettings>("/api/settings/agent");
    expect(after.body.sources.model).toBe("personal");
    expect(after.body.personal.version).toBe(saved.body.version);
    expect(after.body.status.model).toBe("other/model");
    expect((await json<{ model: string }>("/api/summaries/status")).body.model).toBe("other/model");
    expect(await read(SHARED)).toBe(CONFIG);
  });

  test("a shared model sending a key elsewhere waits for approval, and nothing is sent until then", async () => {
    const evil = { baseUrl: "https://attacker.example/v1", apiKeyEnv: "TEST_KEY" };
    const shared = `model:\n  provider: nvidia\n  name: test/model\n  baseUrl: ${evil.baseUrl}\n  apiKeyEnv: TEST_KEY\n`;
    const { json, prompts, read } = await setup({ [SHARED]: shared });
    const status = await json<{ enabled: boolean; problem?: string }>("/api/summaries/status");
    expect(status.body.enabled).toBe(false);
    expect(status.body.problem).toContain("attacker.example");
    const summary = await json<{ error: string }>("/api/summaries", { method: "POST", body: { path: "a.md", text: "word ".repeat(200), headings: [] } });
    expect(summary.status).toBe(503);
    expect(prompts).toHaveLength(0);
    expect((await json<AgentSettings>("/api/settings/agent")).body.approval).toEqual({ model: evil, prefill: false });
    expect((await json("/api/settings/agent/approve", { method: "POST", body: { model: evil } })).status).toBe(200);
    expect((await json<AgentSettings>("/api/settings/agent")).body.approval).toEqual({ prefill: false });
    expect((await json<{ enabled: boolean }>("/api/summaries/status")).body.enabled).toBe(true);
    expect(await read(".specquer/user/approvals.yaml")).toContain("attacker.example");
  });

  test("a model saved to the shared file by this user is approved", async () => {
    const { json } = await setup();
    const before = (await json<AgentSettings>("/api/settings/agent")).body;
    const model = { ...MODEL, baseUrl: "https://other.example/v1" };
    await json("/api/settings/agent", { method: "PUT", body: { scope: "shared", baseVersion: before.shared.version, model } });
    const after = (await json<AgentSettings>("/api/settings/agent")).body;
    expect(after.approval).toEqual({ prefill: false });
    expect(after.status.enabled).toBe(true);
  });

  test("an http URL to another machine is refused", async () => {
    const { request } = await setup();
    const res = await request("/api/settings/agent", { method: "PUT", body: { scope: "personal", baseVersion: "", model: { ...MODEL, baseUrl: "http://example.com/v1" } } });
    expect(res.status).toBe(400);
  });

  test("invalid values are refused", async () => {
    const { request } = await setup();
    for (const body of [
      { scope: "personal", baseVersion: "", summaries: { concurrency: 0 } },
      { scope: "personal", baseVersion: "", summaries: { tokenBudget: 1.5 } },
      { scope: "everyone", baseVersion: "" },
      { scope: "shared", baseVersion: "", model: { ...MODEL, baseUrl: "file:///etc/passwd" } },
      { scope: "shared", baseVersion: "", model: { ...MODEL, apiKeyEnv: "NOT-A-NAME" } },
    ]) {
      expect((await request("/api/settings/agent", { method: "PUT", body })).status).toBe(400);
    }
  });

  test("a stale version answers 409 and a broken file 422", async () => {
    const { request } = await setup({ [PERSONAL]: "summaries: [\n" });
    const stale = await request("/api/settings/agent", { method: "PUT", body: { scope: "shared", baseVersion: "old", summaries: { concurrency: 3 } } });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { version: string }).version).toHaveLength(64);
    const settings = (await (await request("/api/settings/agent")).json()) as AgentSettings;
    expect(settings.personal.error).toContain(PERSONAL);
    const broken = await request("/api/settings/agent", {
      method: "PUT",
      body: { scope: "personal", baseVersion: settings.personal.version, summaries: { concurrency: 3 } },
    });
    expect(broken.status).toBe(422);
  });

  test("the env route says only whether a variable is set", async () => {
    const { json, request } = await setup();
    expect((await json("/api/settings/env?name=TEST_KEY")).body).toEqual({ set: true });
    expect((await json("/api/settings/env?name=MISSING_KEY")).body).toEqual({ set: false });
    expect((await request("/api/settings/env?name=bad-name")).status).toBe(400);
  });
});

describe("model test", () => {
  const post = (app: Awaited<ReturnType<typeof setup>>, body: unknown, signal?: AbortSignal) =>
    app.request("/api/settings/model-test", { method: "POST", body, ...(signal === undefined ? {} : { signal }) } as never);

  test("makes one call with the fixed prompt and reports the time taken", async () => {
    const app = await setup();
    const res = await post(app, { ...MODEL, name: "unsaved/model" });
    const result = (await res.json()) as ModelTestResult;
    expect(result.ok).toBe(true);
    expect(app.prompts).toEqual([MODEL_TEST_PROMPT]);
  });

  test("reports each failure in the user's terms, never with the key", async () => {
    const failures: Array<[unknown, RegExp]> = [
      [Object.assign(new Error("Unauthorized"), { status: 401 }), /rejected the API key in TEST_KEY/],
      [Object.assign(new Error("Not found"), { status: 404 }), /doesn't know the model test\/model/],
      [Object.assign(new Error("Request timed out."), { name: "TimeoutError" }), /No answer within 30 seconds/],
      [Object.assign(new Error("Connection error."), { name: "APIConnectionError" }), /can't be reached/],
      [new Error("Bad things with secret-key-value inside"), /^The provider failed: Bad things with \*\*\* inside$/],
    ];
    for (const [error, expected] of failures) {
      const app = await setup({}, async () => {
        throw error;
      });
      const result = (await (await post(app, MODEL)).json()) as ModelTestResult;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.problem).toMatch(expected);
        expect(result.problem).not.toContain("secret-key-value");
      }
    }
  });

  test("a key variable that isn't set is reported with the restart note", async () => {
    const app = await setup();
    const result = (await (await post(app, { ...MODEL, apiKeyEnv: "UNSET_KEY" })).json()) as ModelTestResult;
    expect(result).toEqual({ ok: false, problem: expect.stringMatching(/UNSET_KEY.*isn't set\. Restart Specquer/) });
    expect(app.prompts).toEqual([]);
  });

  test("a second test aborts the first", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const app = await setup({}, (_prompt, signal) => {
      signals.push(signal);
      if (signals.length > 1) return Promise.resolve("OK");
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    const first = post(app, MODEL);
    while (signals.length === 0) await Bun.sleep(1);
    const second = (await (await post(app, MODEL)).json()) as ModelTestResult;
    expect(second.ok).toBe(true);
    expect(signals[0]?.aborted).toBe(true);
    expect(await (await first).json()).toEqual({ ok: false, problem: "Stopped: another test started." });
  });
});

describe("folder settings routes", () => {
  const anchored = (id: string, uid: string) => `<a id="${id}" data-uid="${uid}"></a>`;
  const ARCHIVED = `${anchored("REQ-00001", "docaaaaaaaa1")}\n\n${anchored("REQ-00002", "secbbbbbbbb2")}\n# Old\n\nText.\n`;

  test("only existing folders inside the root", async () => {
    const { request } = await setup({ "docs/a.md": "# A\n" });
    expect((await request("/api/settings/folder?path=docs")).status).toBe(200);
    expect((await request("/api/settings/folder?path=")).status).toBe(200);
    expect((await request("/api/settings/folder?path=missing")).status).toBe(404);
    expect((await request("/api/settings/folder?path=docs/a.md")).status).toBe(400);
    expect((await request("/api/settings/folder?path=../x")).status).toBe(400);
    const put = await request("/api/settings/folder", { method: "PUT", body: { path: "missing", setting: OFF, baseVersion: "" } });
    expect(put.status).toBe(404);
    const badPrefix = await request("/api/settings/folder", { method: "PUT", body: { path: "docs", setting: { folderType: "inherit", defaultPrefix: "lower" }, baseVersion: "" } });
    expect(badPrefix.status).toBe(400);
  });

  test("turning a folder off retires its sections; turning it back on restores every ID", async () => {
    const { json, read, root } = await setup({ "docs/archive/old.md": ARCHIVED, "docs/a.md": "# A\n" });
    const sectionsOf = async (path: string) => (await json<{ sections: SectionInfo[] }>(`/api/sections?path=${path}`)).body.sections.map((s) => s.id);
    expect(await sectionsOf("docs/archive/old.md")).toEqual(["REQ-00001", "REQ-00002"]);

    let settings = (await json<FolderSettings>("/api/settings/folder?path=docs/archive")).body;
    expect(settings).toMatchObject({ own: INHERIT, inherited: { folderType: { value: "BASELINE", from: "docs" }, defaultPrefix: { value: "REQ", from: "docs" } } });
    let saved = await json<{ version: string; sectioned: boolean }>("/api/settings/folder", {
      method: "PUT",
      body: { path: "docs/archive", setting: OFF, baseVersion: settings.version },
    });
    expect(saved.body.sectioned).toBe(false);
    expect(await read(ARCHIVE_CONFIG)).toEndWith("folderType: NONSECTIONED\n");
    expect(await sectionsOf("docs/archive/old.md")).toEqual([]);
    expect(await read("docs/archive/old.md")).toBe(ARCHIVED);

    // A save while the folder is off adds no anchors; a save elsewhere writes the data files
    const file = (await json<{ version: string }>("/api/file?path=docs/archive/old.md")).body;
    await json("/api/file?path=docs/archive/old.md", { method: "PUT", body: { text: `${ARCHIVED}\n## New\n`, baseVersion: file.version } });
    expect(await read("docs/archive/old.md")).toBe(`${ARCHIVED}\n## New\n`);
    const a = (await json<{ version: string }>("/api/file?path=docs/a.md")).body;
    await json("/api/file?path=docs/a.md", { method: "PUT", body: { text: "# A\n", baseVersion: a.version } });
    expect(await read(".specquer/shared/REQ/sections.yaml")).toContain("retired:");

    settings = (await json<FolderSettings>("/api/settings/folder?path=docs/archive")).body;
    saved = await json("/api/settings/folder", { method: "PUT", body: { path: "docs/archive", setting: INHERIT, baseVersion: settings.version } });
    expect(saved.body.sectioned).toBe(true);
    expect(await Bun.file(join(root, ARCHIVE_CONFIG)).exists()).toBe(false);
    const restored = (await json<{ version: string }>("/api/file?path=docs/archive/old.md")).body;
    const result = await json<{ notices?: unknown[] }>("/api/file?path=docs/archive/old.md", {
      method: "PUT",
      body: { text: `${ARCHIVED}\n## New\n`, baseVersion: restored.version },
    });
    expect(result.body.notices).toBeUndefined();
    const ids = findSections(await read("docs/archive/old.md")).map((s) => s.id);
    expect(ids.slice(0, 2)).toEqual(["REQ-00001", "REQ-00002"]);
    expect(ids).toHaveLength(3);
    expect(ids[2]).not.toBe("REQ-00001");
  });

  test("settings routes write nothing but the configuration files", async () => {
    const { json, root } = await setup({ "docs/a.md": "# A\n", "docs/sub/b.md": "# B\n" });
    const snapshot = async () => {
      const entries = await readdir(root, { recursive: true });
      const files = new Map<string, string>();
      for (const entry of entries.sort()) {
        const file = Bun.file(join(root, entry));
        if ((await file.stat()).isFile()) files.set(entry, await file.text());
      }
      return files;
    };
    const before = await snapshot();
    const agent = (await json<AgentSettings>("/api/settings/agent")).body;
    await json("/api/settings/agent", { method: "PUT", body: { scope: "shared", baseVersion: agent.shared.version, summaries: { concurrency: 3 } } });
    await json("/api/settings/agent", { method: "PUT", body: { scope: "personal", baseVersion: agent.personal.version, summaries: { prefill: false } } });
    const folder = (await json<FolderSettings>("/api/settings/folder?path=docs/sub")).body;
    await json("/api/settings/folder", { method: "PUT", body: { path: "docs/sub", setting: { folderType: "inherit", defaultPrefix: "SUB" }, baseVersion: folder.version } });
    await json("/api/settings/model-test", { method: "POST", body: MODEL });
    const after = await snapshot();
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path)).sort();
    expect(changed).toEqual([".specquer/shared/agent.config.yaml", "docs/sub/.specquer-config.yaml", ".specquer/user/.gitignore", PERSONAL].sort());
  });
});
