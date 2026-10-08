import { expect, test } from "bun:test";
import type { BaseMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import {
  type SectionInput,
  combinedText,
  estimateTokens,
  planSummary,
  sectionInput,
  summarizeSection,
  summarizeWithFallback,
  summaryPrompt,
  toPlainText,
} from "./summarize.ts";

const words = (n: number, word = "word") => Array(n).fill(word).join(" ");

test("the input is simplified and carries the sentence count", () => {
  const input = sectionInput(`<a id="REQ-00001"></a>\r\n# Title\r\n\r\n${words(600)}  \r\n`, "docs/a.md", ["Top"]);
  expect(input.text.startsWith("# Title\n\nword")).toBe(true);
  expect(input.sentences).toBe(4);
});

test("the prompt carries the file name, the headings and the sentence count", () => {
  const [system, user] = summaryPrompt({ text: "# T\n\nBody", path: "docs/a.md", headings: ["Top", "Middle"], sentences: 3 });
  expect(String(system!.content)).toContain("no Markdown");
  const content = String(user!.content);
  expect(content).toContain("Document: docs/a.md");
  expect(content).toContain("Top > Middle");
  expect(content).toContain("in 3 sentences");
  expect(content).toContain("<text>\n# T\n\nBody\n</text>");
});

test("Markdown and HTML are stripped from the output", () => {
  expect(toPlainText("## Summary\n\nThe **server** stores `files` in [a folder](http://x).\n\n\n- It *never* sends <b>HTML</b>.\r\n> Quoted")).toBe(
    "Summary\n\nThe server stores files in a folder.\n\nIt never sends HTML.\nQuoted",
  );
  expect(toPlainText("snake_case_name stays, 2 * 3 * 4 too")).toBe("snake_case_name stays, 2 * 3 * 4 too");
});

test("summarizeSection calls the model and passes the abort signal on", async () => {
  const model = new FakeListChatModel({ responses: ["**A** summary."] });
  let received: BaseMessage[] = [];
  let signal: AbortSignal | undefined;
  const invoke = model.invoke.bind(model);
  model.invoke = (async (messages: BaseMessage[], options?: { signal?: AbortSignal }) => {
    received = messages;
    signal = options?.signal;
    return invoke(messages, options);
  }) as typeof model.invoke;
  const controller = new AbortController();
  const input: SectionInput = { text: "# T\n\nBody", path: "a.md", headings: [], sentences: 2 };
  expect(await summarizeSection(model, input, { signal: controller.signal })).toBe("A summary.");
  expect(received).toHaveLength(2);
  expect(signal).toBe(controller.signal);
});

test("an aborted call rejects", async () => {
  const model = new FakeListChatModel({ responses: ["Late."], sleep: 50 });
  const controller = new AbortController();
  const call = summarizeSection(model, { text: "x", path: "a.md", headings: [], sentences: 2 }, { signal: controller.signal });
  controller.abort();
  await expect(call).rejects.toThrow();
});

test("planning: whole, from subsections, or cut", () => {
  const long = `# Big\n\nLead text.\n\n## One\n\n${words(300, "alpha")}\n\n## Two\n\n${words(20, "beta")}\n`;
  const input = sectionInput(long, "a.md", ["Doc"]);
  expect(planSummary(input, 100_000)).toEqual({ kind: "whole" });
  const plan = planSummary(input, 100);
  if (plan.kind !== "parts") throw new Error(plan.kind);
  expect(plan.lead).toBe("# Big\n\nLead text.");
  expect(plan.parts.map((p) => [p.title, p.input.headings])).toEqual([["One", ["Doc", "Big"]], ["Two", ["Doc", "Big"]]]);
  expect(plan.parts[0]!.input.text.startsWith("## One\n\nalpha")).toBe(true);
  const flat = sectionInput(`# Flat\n\n${words(500)}`, "a.md", []);
  const cut = planSummary(flat, 100);
  expect(cut).toEqual({ kind: "cut", text: flat.text.slice(0, 400) });
  // A whole document with several top-level sections and a preamble
  const doc = planSummary(sectionInput(`Intro\n\n# A\n\n${words(300)}\n\n# B\n\n${words(300)}`, "a.md", []), 100);
  expect(doc.kind === "parts" && [doc.lead, doc.parts.map((p) => p.title)]).toEqual(["Intro", ["A", "B"]]);
});

test("the fallback summarizes subsections first, and short ones count as written", async () => {
  const long = `# Big\n\nLead text.\n\n## One\n\n${words(300, "alpha")}\n\n## Two\n\n${words(20, "beta")}\n`;
  const input = sectionInput(long, "a.md", []);
  const calls: string[] = [];
  const result = await summarizeWithFallback(input, 200, {
    summarizePart: async (part) => {
      calls.push(`part:${part.headings.join(">")}:${part.text.slice(0, 6)}`);
      return { summary: "One in brief.", truncated: false };
    },
    call: async (combined) => {
      calls.push(`call:${combined.sentences}`);
      expect(combined.text).toBe(combinedText("# Big\n\nLead text.", [{ title: "One", summary: "One in brief." }, { title: "Two", summary: `## Two\n\n${words(20, "beta")}` }]));
      return "Big in brief.";
    },
  });
  expect(result).toEqual({ summary: "Big in brief.", truncated: false });
  expect(calls).toEqual(["part:Big:## One", `call:${input.sentences}`]);
  expect(estimateTokens("12345")).toBe(2);
});

test("a cut section is marked truncated", async () => {
  const input = sectionInput(`# Flat\n\n${words(500)}`, "a.md", []);
  const result = await summarizeWithFallback(input, 100, {
    summarizePart: async () => ({ summary: "", truncated: false }),
    call: async (cut) => `${cut.text.length}`,
  });
  expect(result).toEqual({ summary: "400", truncated: true });
});
