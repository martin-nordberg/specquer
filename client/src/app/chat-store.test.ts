import { expect, mock, test } from "bun:test";
import type { ChatEvent, ChatRequest, ChatTurn } from "@specquer/shared/chat";
import { ChatStore, type ChatDependencies } from "./chat-store";
import type { SaveResult } from "./document-store";

const CITATION = { n: 1, path: "docs/a.md", outlinePath: "0", sectionId: "SPEC-00001", title: "A" };
const TURN: ChatTurn = {
  question: { text: "Old?", at: "2026-10-13T11:00:00.000Z" },
  answer: { text: "Old answer.", model: "m/x", elapsedMs: 900, at: "2026-10-13T11:00:01.000Z", stopped: false, citations: [] },
};

/** A controllable stream of events. */
function channel() {
  const queue: Array<ChatEvent | Error | null> = [];
  let wake: (() => void) | null = null;
  const push = (item: ChatEvent | Error | null) => {
    queue.push(item);
    wake?.();
  };
  async function* events(signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    for (;;) {
      while (queue.length === 0) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      const item = queue.shift()!;
      if (item === null) return;
      if (item instanceof Error) throw item;
      yield item;
    }
  }
  return { push, events };
}

function setup(options: { save?: SaveResult[]; turns?: ChatTurn[] } = {}) {
  const saves = [...(options.save ?? [])];
  const stream = channel();
  const requests: ChatRequest[] = [];
  let conflictSettled!: () => void;
  const api = {
    chat: mock(async (request: ChatRequest, signal?: AbortSignal) => {
      requests.push(request);
      return stream.events(signal);
    }),
    chatHistory: mock(async () => options.turns ?? []),
    clearChatHistory: mock(async () => [TURN]),
    restoreChatHistory: mock(async (turns: ChatTurn[]) => turns),
  };
  const deps: ChatDependencies = {
    api,
    saveOpenFile: mock(async () => saves.shift() ?? "clean"),
    conflictSettled: () => new Promise<void>((resolve) => (conflictSettled = resolve)),
    openFile: () => "docs/open.md",
    model: () => "google/gemma",
    now: () => 1_000_000,
  };
  const store = new ChatStore(deps);
  return { store, api, deps, stream, requests, settle: () => conflictSettled() };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("loads the conversation", async () => {
  const { store } = setup({ turns: [TURN] });
  await store.load();
  expect(store.get()).toMatchObject({ turns: [TURN], loaded: true });
});

test("a question saves first, then streams into the pending answer, and ends as a turn", async () => {
  const { store, stream, requests, deps } = setup({ save: ["saved"] });
  const sending = store.send("How?");
  await tick();
  expect(deps.saveOpenFile).toHaveBeenCalledTimes(1);
  expect(requests).toEqual([{ question: "How?", openFile: "docs/open.md" }]);
  stream.push({ type: "status", phase: "searching" });
  stream.push({ type: "citations", citations: [CITATION] });
  stream.push({ type: "status", phase: "thinking" });
  await tick();
  expect(store.get().pending).toMatchObject({ phase: "thinking", citations: [CITATION], text: "" });
  stream.push({ type: "token", text: "It " });
  stream.push({ type: "token", text: "works [1]." });
  await tick();
  expect(store.get().pending).toMatchObject({ phase: "streaming", text: "It works [1]." });
  expect(store.busy).toBe(true);
  stream.push({ type: "done", model: "google/gemma", elapsedMs: 1200, at: "2026-10-13T12:00:00.000Z" });
  stream.push(null);
  await sending;
  expect(store.get().pending).toBeNull();
  expect(store.get().turns.at(-1)!.answer).toEqual({
    text: "It works [1].",
    model: "google/gemma",
    elapsedMs: 1200,
    at: "2026-10-13T12:00:00.000Z",
    stopped: false,
    citations: [CITATION],
  });
  expect(store.get().announcement).toBe("It works [1].");
});

test("a conflict waits until it is settled, then saves again; a failed save keeps the question", async () => {
  const { store, requests, settle, stream } = setup({ save: ["conflict", "saved"] });
  const sending = store.send("After conflict?");
  await tick();
  expect(requests).toEqual([]);
  settle();
  await tick();
  expect(requests).toHaveLength(1);
  stream.push({ type: "done", model: "m", elapsedMs: 1, at: "2026-10-13T12:00:00.000Z" });
  stream.push(null);
  await sending;

  const failing = setup({ save: ["error"] });
  await failing.store.send("Lost?");
  expect(failing.requests).toEqual([]);
  expect(failing.store.get()).toMatchObject({ pending: null, draft: "Lost?" });
});

test("an error event or a failed request leaves a failed answer with Retry", async () => {
  const { store, stream, requests } = setup();
  const sending = store.send("Q?");
  await tick();
  stream.push({ type: "token", text: "Part" });
  stream.push({ type: "error", code: "rate_limited", message: "Try again in a minute." });
  await sending;
  expect(store.get().pending).toMatchObject({ phase: "failed", text: "Part", error: "Try again in a minute." });
  expect(store.busy).toBe(false);
  const retrying = store.retry();
  await tick();
  expect(requests).toHaveLength(2);
  expect(store.get().pending).toMatchObject({ phase: "searching", text: "" });
  stream.push(new Error("Network down"));
  await retrying;
  expect(store.get().pending).toMatchObject({ phase: "failed", error: "Network down" });
});

test("stop keeps the text so far as a stopped turn; with no text the question goes back to the input", async () => {
  const { store, stream } = setup();
  const sending = store.send("Long?");
  await tick();
  stream.push({ type: "token", text: "Some" });
  await tick();
  store.stop();
  await sending;
  expect(store.get().pending).toBeNull();
  expect(store.get().turns.at(-1)!.answer).toMatchObject({ text: "Some", stopped: true, model: "google/gemma" });

  const empty = setup();
  const again = empty.store.send("Nothing yet?");
  await tick();
  empty.store.stop();
  await again;
  expect(empty.store.get()).toMatchObject({ pending: null, draft: "Nothing yet?", turns: [] });
});

test("/clear clears with Undo; other commands are unknown and never sent", async () => {
  const { store, api, requests } = setup({ turns: [TURN] });
  await store.load();
  await store.send("/clear");
  expect(api.clearChatHistory).toHaveBeenCalledTimes(1);
  expect(store.get()).toMatchObject({ turns: [], undo: [TURN] });
  await store.undoClear();
  expect(api.restoreChatHistory).toHaveBeenCalledWith([TURN]);
  expect(store.get()).toMatchObject({ turns: [TURN], undo: null });
  await store.send("/help me");
  expect(store.get().unknownCommand).toBe("/help");
  expect(requests).toEqual([]);
  store.dismissUnknownCommand();
  expect(store.get().unknownCommand).toBeNull();
  store.close();
});

test("one question at a time; blank input does nothing", async () => {
  const { store, requests } = setup();
  await store.send("   ");
  expect(requests).toEqual([]);
  void store.send("First?");
  await tick();
  await store.send("Second?");
  expect(requests).toHaveLength(1);
  store.close();
});
