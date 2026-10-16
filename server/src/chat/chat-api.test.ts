import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { type ChatModel, createChatModel } from "@specquer/agent";
import { type ChatEvent, type ChatTurn, chatEventSchema } from "@specquer/shared/chat";
import { TEST_APPROVALS, tempRoot, testApp } from "../test-support.ts";
import { CHAT_HISTORY_FILE } from "./history.ts";

let cleanups: Array<() => Promise<void> | void> = [];
// Last pushed first, so the services close before their folder is deleted
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

const SHARED = ".specquer/shared/agent.config.yaml";
const CONFIG = "model:\n  provider: nvidia\n  name: test/model\n  apiKeyEnv: TEST_KEY\n";
const SECTIONED = "docs/.specquer-config.yaml";

interface StubOptions {
  /** The answer, streamed in these pieces. */
  pieces?: string[];
  /** A pause before each piece. */
  delay?: number;
  /** Fails before the first piece, or after this many. */
  fail?: { after: number; error: Error & { status?: number } };
}

/** A fake streaming chat model, recording the messages it was given and whether it was stopped. */
function stubModel(options: StubOptions = {}) {
  const calls: Array<Array<{ content: unknown }>> = [];
  const state = { stopped: false };
  const model = {
    async stream(messages: Array<{ content: unknown }>, call: { signal?: AbortSignal }) {
      calls.push(messages);
      const pieces = options.pieces ?? ["The answer ", "is in ", "the specs [1]."];
      return (async function* () {
        for (const [index, piece] of pieces.entries()) {
          if (options.fail !== undefined && options.fail.after === index) throw options.fail.error;
          if (options.delay) await Bun.sleep(options.delay);
          if (call.signal?.aborted) {
            state.stopped = true;
            throw new DOMException("Stopped", "AbortError");
          }
          yield { content: piece };
        }
      })();
    },
  } as unknown as ChatModel;
  return { model, calls, state };
}

async function setup(files: Record<string, string>, stub: StubOptions = {}) {
  const temp = await tempRoot({ [SHARED]: CONFIG, ...TEST_APPROVALS, ...files }, { git: true });
  cleanups.push(temp.cleanup);
  const fake = stubModel(stub);
  /** The output limits models were created with. */
  const maxTokens: Array<number | undefined> = [];
  const app = testApp(temp.root, undefined, {
    env: { TEST_KEY: "secret" },
    createModel: (config, env, options) => {
      maxTokens.push(options?.maxTokens);
      const real = createChatModel(config, env, options);
      return real.ok ? { ...real, model: fake.model } : real;
    },
    warn: () => {},
  });
  cleanups.push(async () => {
    await app.summaries.close();
    await app.chat.close();
  });
  const ask = (question: string, openFile?: string, init: { signal?: AbortSignal } = {}) =>
    app.app.request("/api/chat", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4999",
        cookie: `specquer_session_4999=test-token-0123456789`,
        origin: "http://127.0.0.1:4999",
        "content-type": "application/json",
      },
      body: JSON.stringify({ question, ...(openFile === undefined ? {} : { openFile }) }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
    });
  return { root: temp.root, ...app, ...fake, ask, maxTokens };
}

/** The events of a stream's body. */
async function events(response: Response): Promise<ChatEvent[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .map((block) => block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n"))
    .filter((data) => data !== "")
    .map((data) => chatEventSchema.parse(JSON.parse(data)));
}

const SPECS = {
  [SECTIONED]: "folderType: BASELINE\ndefaultPrefix: SPEC\n",
  "docs/sections.md":
    '<a id="SPEC-00001" data-uid="aaaaaaaaaaaa"></a>\n\n<a id="SPEC-00002" data-uid="bbbbbbbbbbbb"></a>\n# Copies\n\nA copied section gets a new ID when it is renumbered.\n',
  "notes/ideas.md": '<a id="NOTE-00009" data-uid="cccccccccccc"></a>\n# Copies of ideas\n\nCopied ideas are renumbered too.\n',
};

test("a question streams status, citations, the answer and done, and is kept in the history", async () => {
  const { ask, request, calls } = await setup(SPECS);
  const response = await ask("How are copies renumbered?");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const received = await events(response);
  expect(received.map((event) => event.type)).toEqual(["status", "citations", "status", "token", "token", "token", "done"]);
  expect(received[0]).toEqual({ type: "status", phase: "searching" });
  const citations = received[1]!.type === "citations" ? received[1]!.citations : [];
  expect(citations.map((citation) => citation.path).sort()).toEqual(["docs/sections.md", "notes/ideas.md"]);
  const done = received.at(-1)!;
  expect(done).toMatchObject({ type: "done", model: "test/model" });
  // The prompt holds the sources and the question
  expect(String(calls[0]!.at(-1)!.content)).toContain("A copied section gets a new ID");
  expect(String(calls[0]!.at(-1)!.content)).toEndWith("Question: How are copies renumbered?");
  const history = (await (await request("/api/chat/history")).json()) as { turns: ChatTurn[] };
  expect(history.turns).toHaveLength(1);
  expect(history.turns[0]!.answer).toMatchObject({ text: "The answer is in the specs [1].", stopped: false, citations });
});

test("answers get their own output limit, chat.answerTokens", async () => {
  const { ask, maxTokens, root } = await setup(SPECS);
  await events(await ask("copies?"));
  expect(maxTokens).toContain(4_000);
  await Bun.write(join(root, SHARED), `${CONFIG}chat:\n  answerTokens: 8000\n`);
  await Bun.sleep(20);
  await events(await ask("copies?"));
  expect(maxTokens).toContain(8_000);
});

test("a citation keeps its section ID only where the section index holds it", async () => {
  const { ask } = await setup(SPECS);
  const received = await events(await ask("copies renumbered ideas"));
  const citations = received.find((event) => event.type === "citations");
  const byPath = Object.fromEntries((citations?.type === "citations" ? citations.citations : []).map((c) => [c.path, c]));
  expect(byPath["docs/sections.md"]!.sectionId).toBe("SPEC-00002");
  // notes/ isn't sectioned: its anchor is a copy, not a section the index knows
  expect(byPath["notes/ideas.md"]!.sectionId).toBeUndefined();
  expect(byPath["notes/ideas.md"]).toMatchObject({ outlinePath: "0", title: "Copies of ideas" });
});

test("the open file's sections come first; a hidden file is never searched", async () => {
  const { ask, root } = await setup({
    ...SPECS,
    ".gitignore": "secret/\n",
    "secret/plans.md": "# Copies\n\nSecret copies renumbered.\n",
  });
  expect(await Bun.file(join(root, "secret/plans.md")).exists()).toBe(true);
  const received = await events(await ask("copies renumbered", "notes/ideas.md"));
  const citations = received.find((event) => event.type === "citations");
  const paths = citations?.type === "citations" ? citations.citations.map((c) => c.path) : [];
  expect(paths[0]).toBe("notes/ideas.md");
  expect(paths).not.toContain("secret/plans.md");
});

test("follow-ups send the earlier turns", async () => {
  const { ask, calls } = await setup(SPECS);
  await events(await ask("How are copies renumbered?"));
  await events(await ask("And ideas?"));
  const types = calls[1]!.map((message) => (message as unknown as { getType(): string }).getType());
  expect(types).toEqual(["system", "human", "ai", "human"]);
  expect(calls[1]![1]!.content).toBe("How are copies renumbered?");
});

test("without a model the route answers 503 before streaming", async () => {
  const temp = await tempRoot(SPECS);
  cleanups.push(temp.cleanup);
  const app = testApp(temp.root, undefined, { env: {}, warn: () => {} });
  cleanups.push(() => app.chat.close());
  const response = await app.request("/api/chat", { method: "POST", body: { question: "Hi?" } });
  expect(response.status).toBe(503);
  expect(((await response.json()) as { error: string }).error).toBe("not_configured");
  expect((await app.request("/api/chat", { method: "POST", body: { question: " " } })).status).toBe(400);
});

test("a rate limit before or during the answer is an error event, and nothing is kept", async () => {
  const rateLimit = Object.assign(new Error("429 Too Many Requests"), { status: 429 });
  for (const after of [0, 1]) {
    const { ask, request } = await setup(SPECS, { fail: { after, error: rateLimit } });
    const received = await events(await ask("copies?"));
    expect(received.at(-1)).toMatchObject({ type: "error", code: "rate_limited" });
    expect(received.filter((event) => event.type === "token")).toHaveLength(after);
    expect(((await (await request("/api/chat/history")).json()) as { turns: unknown[] }).turns).toEqual([]);
  }
  const { ask } = await setup(SPECS, { fail: { after: 0, error: new Error("boom\nmore") } });
  expect((await events(await ask("copies?"))).at(-1)).toEqual({ type: "error", code: "provider_error", message: "The model provider failed: boom" });
});

test("stopping the request stops the model and keeps the text so far as a stopped answer", async () => {
  const { ask, request, state, root } = await setup(SPECS, { pieces: ["One ", "two ", "three ", "four ", "five."], delay: 30 });
  const controller = new AbortController();
  const response = await ask("copies?", undefined, { signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes('"type":"token"')) text += decoder.decode((await reader.read()).value);
  controller.abort();
  await reader.cancel().catch(() => undefined);
  await Bun.sleep(150);
  expect(state.stopped).toBe(true);
  const turns = ((await (await request("/api/chat/history")).json()) as { turns: ChatTurn[] }).turns;
  expect(turns).toHaveLength(1);
  expect(turns[0]!.answer.stopped).toBe(true);
  expect(turns[0]!.answer.text.length).toBeGreaterThan(0);
  expect(turns[0]!.answer.text).not.toContain("five");
  expect(await Bun.file(join(root, CHAT_HISTORY_FILE)).exists()).toBe(true);
});

test("history routes: read, clear (returning the turns) and restore", async () => {
  const { ask, request } = await setup(SPECS);
  await events(await ask("copies?"));
  const cleared = (await (await request("/api/chat/history", { method: "DELETE" })).json()) as { turns: ChatTurn[] };
  expect(cleared.turns).toHaveLength(1);
  expect(((await (await request("/api/chat/history")).json()) as { turns: unknown[] }).turns).toEqual([]);
  const restored = await request("/api/chat/history", { method: "PUT", body: { turns: cleared.turns } });
  expect(((await restored.json()) as { turns: unknown[] }).turns).toEqual(cleared.turns);
  expect((await request("/api/chat/history", { method: "PUT", body: { turns: [{ bad: 1 }] } })).status).toBe(400);
});
