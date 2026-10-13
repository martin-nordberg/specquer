import { expect, test } from "bun:test";
import { type ChatEvent, chatEventSchema, chatHistorySchema, chatRequestSchema, formatElapsed } from "./chat.ts";

test("a question is 1 to 8,000 characters, not blank, with an optional Markdown file", () => {
  expect(chatRequestSchema.safeParse({ question: "What is a section?" }).success).toBe(true);
  expect(chatRequestSchema.safeParse({ question: "Why?", openFile: "docs/a.md" }).success).toBe(true);
  expect(chatRequestSchema.safeParse({ question: "  \n" }).success).toBe(false);
  expect(chatRequestSchema.safeParse({ question: "x".repeat(8001) }).success).toBe(false);
  expect(chatRequestSchema.safeParse({ question: "Why?", openFile: "../a.md" }).success).toBe(false);
  expect(chatRequestSchema.safeParse({ question: "Why?", openFile: "docs/a.txt" }).success).toBe(false);
});

test("events round-trip through JSON", () => {
  const events: ChatEvent[] = [
    { type: "status", phase: "searching" },
    { type: "citations", citations: [{ n: 1, path: "a.md", outlinePath: "0", sectionId: "SPEC-00001", title: "A" }] },
    { type: "status", phase: "thinking" },
    { type: "token", text: "An answer [1]." },
    { type: "done", model: "google/gemma", elapsedMs: 1234, at: "2026-10-13T12:00:00.000Z" },
    { type: "error", code: "rate_limited", message: "Try again." },
  ];
  for (const event of events) expect(chatEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  expect(chatEventSchema.safeParse({ type: "token" }).success).toBe(false);
  expect(chatEventSchema.safeParse({ type: "other", text: "x" }).success).toBe(false);
});

test("the history drops invalid turns one by one", () => {
  const turn = {
    question: { text: "Q", at: "2026-10-13T12:00:00Z" },
    answer: { text: "A", model: "m", elapsedMs: 5, at: "2026-10-13T12:00:01Z", stopped: false, citations: [] },
  };
  expect(chatHistorySchema.parse({ version: 1, turns: [turn, { question: "bad" }, turn] }).turns).toEqual([turn, turn]);
  expect(chatHistorySchema.parse({ turns: "nope" })).toEqual({ version: 1, turns: [] });
  expect(chatHistorySchema.parse({})).toEqual({ version: 1, turns: [] });
});

test("formatElapsed", () => {
  expect(formatElapsed(0)).toBe("under 1 s");
  expect(formatElapsed(999)).toBe("under 1 s");
  expect(formatElapsed(1000)).toBe("1 s");
  expect(formatElapsed(59_999)).toBe("59 s");
  expect(formatElapsed(60_000)).toBe("1 min");
  expect(formatElapsed(72_400)).toBe("1 min 12 s");
});
