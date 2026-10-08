import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { type ChatModel, createChatModel } from "@specquer/agent";
import { tempRoot, testApp } from "../test-support.ts";
import { CACHE_FILE, MAX_AGE } from "./cache.ts";
import type { SummaryServiceOptions } from "./service.ts";

let cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

const SHARED = ".specquer/shared/agent.config.yaml";
const CONFIG = "model:\n  provider: nvidia\n  name: test/model\n  apiKeyEnv: TEST_KEY\nsummaries:\n  concurrency: 2\n";

/** A fake chat model: answers with `reply`, recording the prompts it was given. */
function fakeModel(reply: (prompt: string) => Promise<string> | string = () => "A summary.") {
  const prompts: string[] = [];
  const model = {
    async invoke(messages: Array<{ content: unknown }>) {
      const prompt = String(messages.at(-1)?.content);
      prompts.push(prompt);
      return { content: await reply(prompt) };
    },
  } as unknown as ChatModel;
  return { model, prompts };
}

async function setup(files: Record<string, string> = { [SHARED]: CONFIG }, options: Partial<SummaryServiceOptions> & { reply?: (prompt: string) => Promise<string> | string } = {}) {
  const temp = await tempRoot(files);
  const fake = fakeModel(options.reply);
  const app = testApp(temp.root, undefined, {
    env: { TEST_KEY: "secret" },
    createModel: (config, env) => {
      const real = createChatModel(config, env);
      return real.ok ? { ok: true, id: real.id, model: fake.model } : real;
    },
    warn: () => {},
    ...options,
  });
  cleanups.push(temp.cleanup, () => app.summaries.close());
  const summarize = (text: string, headings: string[] = []) => app.request("/api/summaries", { method: "POST", body: { path: "docs/a.md", text, headings } });
  return { root: temp.root, ...app, ...fake, summarize };
}

const words = (n: number, word = "word") => Array(n).fill(word).join(" ");
const SECTION = `<a id="REQ-00002" data-uid="bbbbbbbbbbbb"></a>\n## Section\n\n${words(300)}\n`;

describe("status", () => {
  test("not configured without a configuration", async () => {
    const { request, summarize } = await setup({});
    expect(await (await request("/api/summaries/status")).json()).toEqual({ enabled: false, problem: expect.stringContaining("agent.config.yaml") });
    const res = await summarize(SECTION);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "not_configured" });
  });

  test("not configured without the key", async () => {
    const { request } = await setup(undefined, { env: {} });
    expect(await (await request("/api/summaries/status")).json()).toEqual({ enabled: false, problem: expect.stringContaining("TEST_KEY") });
  });

  test("enabled, and the user file overrides the shared one", async () => {
    const { request, root } = await setup();
    expect(await (await request("/api/summaries/status")).json()).toEqual({ enabled: true, model: "test/model" });
    await Bun.write(join(root, ".specquer/user/agent.config.yaml"), "model:\n  provider: nvidia\n  name: mine/model\n  apiKeyEnv: TEST_KEY\n");
    expect(await (await request("/api/summaries/status")).json()).toEqual({ enabled: true, model: "mine/model" });
  });
});

describe("summarizing", () => {
  test("calls the model once, then answers from the cache", async () => {
    const { summarize, prompts, root } = await setup();
    const first = await summarize(SECTION, ["Top"]);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ summary: "A summary.", model: "test/model", cached: false, truncated: false });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Document: docs/a.md");
    expect(prompts[0]).toContain("Section within: Top");
    expect(prompts[0]).not.toContain("REQ-00002");
    // Other line endings and anchor metadata make the same key
    const again = await summarize(SECTION.replace(/\n/g, "\r\n").replace("bbbbbbbbbbbb", "cccccccccccc"));
    expect(await again.json()).toMatchObject({ summary: "A summary.", cached: true });
    expect(prompts).toHaveLength(1);
    expect(await Bun.file(join(root, ".specquer/cache/.gitignore")).text()).toBe("*\n");
  });

  test("short sections come back as written without a model call", async () => {
    const { summarize, prompts } = await setup();
    const res = await summarize("## Short\n\nOnly a few words.\n");
    expect(await res.json()).toMatchObject({ summary: "## Short\n\nOnly a few words.", cached: false });
    expect(prompts).toHaveLength(0);
  });

  test("summaries older than 30 days are ignored and purged", async () => {
    let now = 1_000_000_000_000;
    const { summarize, prompts, summaries, root } = await setup(undefined, { now: () => now });
    await summarize(SECTION);
    now += MAX_AGE + 1;
    expect(await (await summarize(SECTION)).json()).toMatchObject({ cached: false });
    expect(prompts).toHaveLength(2);
    // The second summary is fresh; the purge a day later deletes nothing until it expires too
    const count = () => {
      const db = new Database(join(root, CACHE_FILE), { readonly: true });
      try {
        return (db.query("SELECT count(*) AS n FROM summaries").get() as { n: number }).n;
      } finally {
        db.close();
      }
    };
    now += MAX_AGE + 1;
    await summaries.purge();
    expect(count()).toBe(0);
  });

  test("a damaged database is moved aside and created again", async () => {
    const { summarize, root, prompts } = await setup({ [SHARED]: CONFIG, [CACHE_FILE]: "this is not a database ".repeat(100) });
    expect((await summarize(SECTION)).status).toBe(200);
    expect(await (await summarize(SECTION)).json()).toMatchObject({ cached: true });
    expect(prompts).toHaveLength(1);
    const files = await Array.fromAsync(new Bun.Glob("summaries.db*").scan(join(root, ".specquer/cache")));
    expect(files.some((file) => file.includes(".damaged-"))).toBe(true);
  });

  test("identical requests share one call", async () => {
    const { summarize, prompts } = await setup(undefined, {
      reply: async () => {
        await Bun.sleep(20);
        return "Shared.";
      },
    });
    const results = await Promise.all([summarize(SECTION), summarize(SECTION)]);
    expect(await Promise.all(results.map((r) => r.json()))).toEqual([
      expect.objectContaining({ summary: "Shared." }),
      expect.objectContaining({ summary: "Shared." }),
    ]);
    expect(prompts).toHaveLength(1);
  });

  test("an aborted request drops its call", async () => {
    const { summaries, prompts } = await setup(undefined, {
      reply: async () => {
        await Bun.sleep(50);
        return "Late.";
      },
    });
    const controller = new AbortController();
    const pending = summaries.summarize({ path: "docs/a.md", text: SECTION, headings: [] }, controller.signal);
    controller.abort(new DOMException("Gone", "AbortError"));
    await expect(pending).rejects.toThrow("Gone");
    expect(prompts.length).toBeLessThanOrEqual(1);
  });

  test("a long section is summarized from its subsections' summaries", async () => {
    const { summarize, prompts } = await setup({ [SHARED]: CONFIG + "  tokenBudget: 1000\n" }, { reply: (prompt) => (prompt.includes("Summary of the subsection") ? "Whole." : "Part.") });
    const long = `# Big\n\nLead.\n\n## One\n\n${words(500, "alpha")}\n\n## Two\n\n${words(500, "beta")}\n`;
    expect(await (await summarize(long)).json()).toMatchObject({ summary: "Whole.", truncated: false });
    expect(prompts).toHaveLength(3);
    // The subsections' summaries are cached on their own
    expect(await (await summarize(`## One\n\n${words(500, "alpha")}\n`, ["Big"])).json()).toMatchObject({ summary: "Part.", cached: true });
  });

  test("provider errors map to 429 and 502", async () => {
    const rateLimited = await setup(undefined, {
      reply: () => {
        throw Object.assign(new Error("429 Too Many Requests"), { status: 429 });
      },
    });
    const limited = await rateLimited.summarize(SECTION);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });

    const failing = await setup(undefined, {
      reply: () => {
        throw new Error("connect ECONNREFUSED\nmore detail");
      },
    });
    const failed = await failing.summarize(SECTION);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "provider_error", message: "The model provider failed: connect ECONNREFUSED" });
  });

  test("rejects text over 1 MB", async () => {
    const { summarize } = await setup();
    expect((await summarize("x".repeat(1_000_001))).status).toBe(400);
  });
});
