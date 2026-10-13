import { expect, test } from "bun:test";
import type { ChatEvent } from "@specquer/shared/chat";
import { readEvents } from "./api";

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
