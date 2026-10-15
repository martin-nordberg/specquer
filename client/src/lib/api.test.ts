import { afterEach, expect, test } from "bun:test";
import type { ChatEvent } from "@specquer/shared/chat";
import { KEEPALIVE_LIMIT, KeepaliveBudget, httpApi, readEvents } from "./api";

/** A stream delivering these chunks. */
function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of readEvents(body)) events.push(event);
  return events;
}

test("reads events split anywhere across chunks, skipping keep-alive comments", async () => {
  const text =
    'event: status\ndata: {"type":"status","phase":"searching"}\n\n: keep-alive\n\nevent: token\ndata: {"type":"token","text":"Hi [1]."}\n\n';
  for (const size of [1, 3, 7, text.length]) {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    expect(await collect(stream(chunks))).toEqual([
      { type: "status", phase: "searching" },
      { type: "token", text: "Hi [1]." },
    ]);
  }
});

test("CRLF line endings and multi-byte characters split across chunks", async () => {
  const bytes = new TextEncoder().encode('data: {"type":"token","text":"Über ✓"}\r\n\r\n');
  const parts = [bytes.slice(0, 22), bytes.slice(22, 33), bytes.slice(33)];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
  expect(await collect(body)).toEqual([{ type: "token", text: "Über ✓" }]);
});

test("a malformed event is an error, never trusted", async () => {
  await expect(collect(stream(['data: {"type":"token"}\n\n']))).rejects.toThrow();
  await expect(collect(stream(["data: not json\n\n"]))).rejects.toThrow();
});

test("the keepalive budget counts UTF-8 bytes of the JSON body, shared by requests in flight", () => {
  const budget = new KeepaliveBudget(1000);
  // 300 characters, but 600 bytes as UTF-8 and more as JSON
  expect(budget.reserve({ text: "é".repeat(300) })).not.toBeNull();
  expect(budget.reserve({ text: "é".repeat(300) })).toBeNull();
  const small = budget.reserve({ text: "x".repeat(100) });
  expect(small).not.toBeNull();
  small!();
  small!();
  expect(budget.reserve({ text: "x".repeat(300) })).not.toBeNull();
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stubs fetch: records each request's keepalive flag, answering only when `release` is called. */
function stubFetch() {
  const sent: Array<{ url: string; keepalive: boolean }> = [];
  const pending: Array<() => void> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    sent.push({ url, keepalive: (input instanceof Request ? input.keepalive : init?.keepalive) === true });
    await new Promise<void>((resolve) => pending.push(resolve));
    return new Response(JSON.stringify({ version: "v" }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { sent, release: () => pending.splice(0).forEach((resolve) => resolve()) };
}

test("leaving the page: a document too large in bytes is sent without keepalive", async () => {
  const { sent, release } = stubFetch();
  // Fewer characters than the limit, but about twice as many bytes
  const text = "é\n".repeat(KEEPALIVE_LIMIT / 4 + 1000);
  expect(text.length).toBeLessThan(KEEPALIVE_LIMIT);
  const saving = httpApi.saveFile("a.md", text, "v0", { keepalive: true });
  await Bun.sleep(0);
  release();
  await saving;
  expect(sent.map((request) => request.keepalive)).toEqual([false]);
});

test("leaving the page: the document, then the UI state and comment draft, share one budget", async () => {
  const { sent, release } = stubFetch();
  const requests = [
    httpApi.saveFile("a.md", "x".repeat(40_000), "v0", { keepalive: true }),
    httpApi.patchUiState({ theme: "dark" }, { keepalive: true }),
    httpApi.changeComments("a.md", { op: "reply", threadUid: "aaaaaaaaaaaa", text: "ü".repeat(10_000) }, { keepalive: true }),
  ];
  await Bun.sleep(0);
  expect(sent.map((request) => request.keepalive)).toEqual([true, true, false]);
  release();
  await Promise.allSettled(requests);
  // Released once answered
  const later = httpApi.saveFile("a.md", "x".repeat(40_000), "v0", { keepalive: true });
  await Bun.sleep(0);
  release();
  await later;
  expect(sent.at(-1)?.keepalive).toBe(true);
});
