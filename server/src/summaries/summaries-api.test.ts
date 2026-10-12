import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { type ChatModel, createChatModel } from "@specquer/agent";
import { tempRoot, testApp } from "../test-support.ts";
import { summaryBody, summaryTargets } from "@specquer/shared/summaries";
import { CACHE_FILE, MAX_UNUSED } from "./cache.ts";
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

type SetupOptions = Partial<SummaryServiceOptions> & { reply?: (prompt: string) => Promise<string> | string };

async function setup(files: Record<string, string> = { [SHARED]: CONFIG }, options: SetupOptions = {}) {
  const temp = await tempRoot(files);
  cleanups.push(temp.cleanup);
  return setupIn(temp.root, options);
}

/** The app on an existing root folder, with a fake model. */
async function setupIn(root: string, options: SetupOptions = {}) {
  const fake = fakeModel(options.reply);
  const app = testApp(root, undefined, {
    env: { TEST_KEY: "secret" },
    createModel: (config, env) => {
      const real = createChatModel(config, env);
      return real.ok ? { ...real, model: fake.model } : real;
    },
    warn: () => {},
    ...options,
  });
  cleanups.push(() => app.summaries.close());
  const summarize = (text: string, headings: string[] = [], accept?: "any" | "current") =>
    app.request("/api/summaries", { method: "POST", body: { path: "docs/a.md", text, headings, ...(accept === undefined ? {} : { accept }) } });
  return { root, ...app, ...fake, summarize };
}

/** The number of cached summaries. */
function count(root: string): number {
  const db = new Database(join(root, CACHE_FILE), { readonly: true });
  try {
    return (db.query("SELECT count(*) AS n FROM summaries").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

const words = (n: number, word = "word") => Array(n).fill(word).join(" ");
const SECTION = `<a id="REQ-00002" data-uid="bbbbbbbbbbbb"></a>\n## Section\n\n${words(300)}\n`;

describe("status", () => {
  test("not configured without a configuration", async () => {
    const { request, summarize } = await setup({});
    expect(await (await request("/api/summaries/status")).json()).toEqual({ enabled: false, problem: expect.stringContaining("agent.config.yaml"), prefill: { enabled: false, pending: 0 } });
    const res = await summarize(SECTION);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "not_configured" });
  });

  test("not configured without the key", async () => {
    const { request } = await setup(undefined, { env: {} });
    expect(await (await request("/api/summaries/status")).json()).toEqual({ enabled: false, problem: expect.stringContaining("TEST_KEY"), prefill: { enabled: false, pending: 0 } });
  });

  test("enabled, and the user file overrides the shared one", async () => {
    const { request, root } = await setup();
    expect(await (await request("/api/summaries/status")).json()).toEqual({ enabled: true, model: "test/model", prefill: { enabled: false, pending: 0 } });
    await Bun.write(join(root, ".specquer/user/agent.config.yaml"), "model:\n  provider: nvidia\n  name: mine/model\n  apiKeyEnv: TEST_KEY\n");
    expect(await (await request("/api/summaries/status")).json()).toEqual({ enabled: true, model: "mine/model", prefill: { enabled: false, pending: 0 } });
  });
});

describe("summarizing", () => {
  test("calls the model once, then answers from the cache", async () => {
    const { summarize, prompts, root } = await setup();
    const first = await summarize(SECTION, ["Top"]);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ summary: "A summary.", model: "test/model", cached: false, truncated: false, current: true });
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

  test("summaries unused for 60 days are purged; reading one keeps it", async () => {
    let now = 1_000_000_000_000;
    const { summarize, prompts, summaries, root } = await setup(undefined, { now: () => now });
    await summarize(SECTION);
    await summarize(`## Other\n\n${words(300, "other")}\n`);
    expect(prompts).toHaveLength(2);
    const day = 24 * 60 * 60 * 1000;
    now += MAX_UNUSED - day;
    // Used again: it stays
    expect(await (await summarize(SECTION)).json()).toMatchObject({ cached: true });
    // Purges run at most once a day
    now += day + 1000;
    await summaries.purge();
    expect(count(root)).toBe(1);
    expect(await (await summarize(SECTION)).json()).toMatchObject({ cached: true });
    expect(prompts).toHaveLength(2);
  });

  test("a cache from an older version is emptied, not misread", async () => {
    const temp = await tempRoot({ [SHARED]: CONFIG });
    cleanups.push(temp.cleanup);
    await Bun.write(join(temp.root, ".specquer/cache/.gitignore"), "*\n");
    const old = new Database(join(temp.root, CACHE_FILE), { create: true });
    old.run("CREATE TABLE summaries (key TEXT PRIMARY KEY, model TEXT, prompt_version INTEGER, summary TEXT, truncated INTEGER, created_at INTEGER)");
    old.run("INSERT INTO summaries VALUES ('k', 'test/model', 1, 'Old.', 0, 0)");
    old.close();
    const { summarize, prompts } = await setupIn(temp.root);
    expect(await (await summarize(SECTION)).json()).toMatchObject({ summary: "A summary.", cached: false });
    expect(prompts).toHaveLength(1);
    expect(count(temp.root)).toBe(1);
  });

  test("the same model name at another URL has its own summaries", async () => {
    const { summarize, prompts, root } = await setup();
    await summarize(SECTION);
    await Bun.write(join(root, SHARED), CONFIG.replace("apiKeyEnv", "baseUrl: http://127.0.0.1:9/v1\n  apiKeyEnv"));
    expect(await (await summarize(SECTION)).json()).toMatchObject({ model: "test/model", cached: false });
    expect(prompts).toHaveLength(2);
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

const PREFIXES = ".specquer/shared/section-prefixes.config.yaml";
const DOC = [
  '<a id="REQ-00001" data-uid="aaaaaaaaaaaa"></a>',
  "",
  "# Spec",
  "",
  "Lead.",
  "",
  '<a id="REQ-00002" data-uid="bbbbbbbbbbbb"></a>',
  "## Long",
  "",
  words(300, "long"),
  "",
  '## <a id="REQ-00003" data-uid="cccccccccccc"></a>Short',
  "",
  "Few words.",
  "",
  '- <a id="REQ-00004" data-uid="dddddddddddd"></a>An item with some words.',
  '- <a id="REQ-00005" data-uid="eeeeeeeeeeee"></a>Another item.',
  "",
].join("\n");

/** The request the preview makes for a section of DOC, by outline path. */
function previewRequest(path: string) {
  const target = summaryTargets(summaryBody(DOC)).find((candidate) => candidate.path === path)!;
  return { path: "docs/a.md", text: target.text, headings: target.headings };
}

describe("lookup by section ID", () => {
  const files = { [SHARED]: CONFIG, [PREFIXES]: 'prefixes:\n  "docs/": REQ\n', "docs/a.md": DOC };
  const lookup = async (request: (path: string) => Promise<Response> | Response, id: string) => request(`/api/summaries/sections/${id}`);

  test("short sections and list items as written; none before the summary is made, then the slider's summary", async () => {
    const { request, prompts } = await setup(files);
    expect(await (await lookup(request, "REQ-00003")).json()).toEqual({ kind: "text", text: "## Short\n\nFew words.\n\n- An item with some words.\n- Another item." });
    expect(await (await lookup(request, "REQ-00004")).json()).toEqual({ kind: "text", text: "- An item with some words." });
    expect(await (await lookup(request, "REQ-00002")).json()).toEqual({ kind: "none" });
    expect(await (await lookup(request, "REQ-00001")).json()).toEqual({ kind: "none" });
    expect(prompts).toHaveLength(0);
    // The anchor on the line before its heading: the section the slider summarizes at level 2
    await request("/api/summaries", { method: "POST", body: previewRequest("0.0") });
    expect(await (await lookup(request, "REQ-00002")).json()).toEqual({ kind: "summary", summary: "A summary.", model: "test/model", truncated: false, current: true });
    // The document's root section: the whole document's summary
    await request("/api/summaries", { method: "POST", body: previewRequest("") });
    expect(await (await lookup(request, "REQ-00001")).json()).toMatchObject({ kind: "summary", summary: "A summary." });
    expect(prompts).toHaveLength(2);
  });

  test("an unknown ID is 404, and anything else is 400", async () => {
    const { request } = await setup(files);
    expect((await lookup(request, "REQ-00099")).status).toBe(404);
    expect((await lookup(request, "nonsense")).status).toBe(400);
  });

  test("answers from the cache with summaries disabled, and never calls the model", async () => {
    const { request, prompts, root } = await setup(files);
    await request("/api/summaries", { method: "POST", body: previewRequest("0.0") });
    await Bun.write(join(root, SHARED), "# no model\n");
    expect(await (await request("/api/summaries/status")).json()).toMatchObject({ enabled: false });
    expect(await (await lookup(request, "REQ-00002")).json()).toEqual({ kind: "summary", summary: "A summary.", model: "test/model", truncated: false, current: false });
    expect(prompts).toHaveLength(1);
  });
});

describe("another model's summary", () => {
  test("accept: any answers with an older model's summary at once; current asks the configured model", async () => {
    const { summarize, prompts, root } = await setup();
    await summarize(SECTION);
    await Bun.write(join(root, SHARED), CONFIG.replace("test/model", "better/model"));
    expect(await (await summarize(SECTION, [], "any")).json()).toEqual({ summary: "A summary.", model: "test/model", cached: true, truncated: false, current: false });
    expect(prompts).toHaveLength(1);
    expect(await (await summarize(SECTION, [], "current")).json()).toMatchObject({ model: "better/model", cached: false, current: true });
    expect(prompts).toHaveLength(2);
    // Now the configured model's is found first
    expect(await (await summarize(SECTION, [], "any")).json()).toMatchObject({ model: "better/model", cached: true, current: true });
  });

  test("accept: any with nothing cached summarizes as usual", async () => {
    const { summarize, prompts } = await setup();
    expect(await (await summarize(SECTION, [], "any")).json()).toMatchObject({ cached: false, current: true });
    expect(prompts).toHaveLength(1);
  });
});

/** Waits until `check` holds, or fails after `timeout` ms. */
async function until(check: () => boolean | Promise<boolean>, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Timed out waiting");
    await Bun.sleep(5);
  }
}

describe("pre-filling", () => {
  const PREFILL = CONFIG + "  prefill: true\n";
  const BIG = `# Big\n\n${words(70, "lead")}\n\n## One\n\n${words(300, "alpha")}\n\n### Deep\n\n${words(200, "deep")}\n\n## Two\n\n${words(300, "beta")}\n`;
  // Targets: Deep, One, Two, Big, and the document (the same text as Big, so one call)
  const BIG_CALLS = 4;
  const options = { prefillDelay: 5, prefillBackoff: 30 };
  const reply = (prompt: string) => `Summary of ${prompt.match(/<text>\n(.*)/)?.[1] ?? "?"}`;

  test("nothing happens when it is off, or without a key", async () => {
    const off = await setup({ [SHARED]: CONFIG, "docs/big.md": BIG }, options);
    off.summaries.filesChanged();
    const noKey = await setup({ [SHARED]: PREFILL, "docs/big.md": BIG }, { ...options, env: {} });
    noKey.summaries.filesChanged();
    await Bun.sleep(100);
    expect(off.prompts).toHaveLength(0);
    expect(noKey.prompts).toHaveLength(0);
  });

  test("a pass summarizes deeper sections first and skips what is cached", async () => {
    const { summaries, summarize, prompts, request } = await setup({ [SHARED]: PREFILL, "docs/big.md": BIG }, { ...options, reply });
    // Made by the slider first: not summarized again
    const body = summaryBody(BIG);
    const two = summaryTargets(body).find((target) => target.path === "0.1")!;
    await summarize(two.text, two.headings);
    expect(prompts).toHaveLength(1);
    summaries.filesChanged();
    await until(() => prompts.length === BIG_CALLS);
    await until(async () => ((await (await request("/api/summaries/status")).json()) as { prefill: { pending: number } }).prefill.pending === 0);
    const order = prompts.map((prompt) => prompt.match(/<text>\n(.*)/)?.[1]);
    expect(order).toEqual(["## Two", "### Deep", "## One", "# Big"]);
    // Unchanged files are skipped by the next pass
    summaries.filesChanged();
    await Bun.sleep(50);
    expect(prompts).toHaveLength(BIG_CALLS);
  });

  test("an interactive request overtakes the background backlog", async () => {
    const { summaries, summarize, prompts } = await setup(
      { [SHARED]: PREFILL, "docs/big.md": BIG },
      {
        ...options,
        reply: async (prompt) => {
          await Bun.sleep(30);
          return reply(prompt);
        },
      },
    );
    summaries.filesChanged();
    await until(() => prompts.length === 1);
    const started = Date.now();
    await summarize(SECTION);
    // It started at once in the free slot, while the first background call still ran
    expect(prompts[1]).toContain("## Section");
    expect(Date.now() - started).toBeLessThan(200);
    await until(() => prompts.length === BIG_CALLS + 1);
  });

  test("a rate limit pauses pre-filling, which then carries on", async () => {
    let failures = 2;
    const { summaries, prompts, request } = await setup(
      { [SHARED]: PREFILL, "docs/big.md": BIG },
      {
        ...options,
        reply: (prompt) => {
          if (failures-- > 0) throw Object.assign(new Error("429 Too Many Requests"), { status: 429 });
          return reply(prompt);
        },
      },
    );
    summaries.filesChanged();
    await until(() => prompts.length >= 1);
    // Paused: nothing more for a while
    await Bun.sleep(5);
    const paused = prompts.length;
    expect(paused).toBe(1);
    await Bun.sleep(15);
    expect(prompts).toHaveLength(paused);
    await until(async () => {
      const status = (await (await request("/api/summaries/status")).json()) as { prefill: { pending: number } };
      return prompts.length === BIG_CALLS + 2 && status.prefill.pending === 0;
    });
  });

  test("a save starts another pass over the changed file", async () => {
    const { summaries, prompts, request } = await setup({ [SHARED]: PREFILL, "docs/big.md": BIG }, { ...options, reply });
    summaries.filesChanged();
    await until(() => prompts.length === BIG_CALLS);
    const file = (await (await request("/api/file?path=docs/big.md")).json()) as { version: string };
    const edited = BIG.replace("## Two", "## Changed");
    expect((await request("/api/file?path=docs/big.md", { method: "PUT", body: { text: edited, baseVersion: file.version } })).status).toBe(200);
    // Two (renamed) changed, and so did Big and the document, which hold it
    await until(() => prompts.length === BIG_CALLS + 2);
    expect(prompts.slice(BIG_CALLS).map((prompt) => prompt.match(/<text>\n(.*)/)?.[1])).toEqual(["## Changed", "# Big"]);
  });

  test("turning it off stops the calls still waiting", async () => {
    const { summaries, prompts, root, request } = await setup(
      { [SHARED]: PREFILL, "docs/big.md": BIG },
      {
        ...options,
        reply: async (prompt) => {
          await Bun.sleep(40);
          return reply(prompt);
        },
      },
    );
    summaries.filesChanged();
    await until(() => prompts.length === 1);
    await Bun.write(join(root, SHARED), CONFIG);
    expect(await (await request("/api/summaries/status")).json()).toMatchObject({ prefill: { enabled: false } });
    await Bun.sleep(150);
    expect(prompts).toHaveLength(1);
  });
});
