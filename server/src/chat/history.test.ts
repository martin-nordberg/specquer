import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { ChatTurn } from "@specquer/shared/chat";
import { tempRoot } from "../test-support.ts";
import { CHAT_HISTORY_FILE, ChatHistoryFile } from "./history.ts";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((cleanup) => cleanup()));
  cleanups = [];
});

async function setup() {
  const temp = await tempRoot();
  cleanups.push(temp.cleanup);
  const warnings: string[] = [];
  const history = new ChatHistoryFile(temp.root, () => 1234, (message) => warnings.push(message));
  return { root: temp.root, history, warnings };
}

const turn = (n: number, text = `Answer ${n}.`): ChatTurn => ({
  question: { text: `Question ${n}?`, at: "2026-10-13T12:00:00.000Z" },
  answer: {
    text,
    model: "google/gemma",
    elapsedMs: 1000 + n,
    at: "2026-10-13T12:00:01.000Z",
    stopped: false,
    citations: [{ n: 1, path: "docs/a.md", outlinePath: "0", sectionId: "SPEC-00001", title: "A" }],
  },
});

test("appends and reads turns; an absent file is an empty conversation", async () => {
  const { history } = await setup();
  expect(await history.read()).toEqual([]);
  await history.append(turn(1));
  await history.append(turn(2, "Line one.\n\n- item [1]\n"));
  expect(await history.read()).toEqual([turn(1), turn(2, "Line one.\n\n- item [1]\n")]);
});

test("the file is readable YAML in .specquer/user, which gets its .gitignore", async () => {
  const { root, history } = await setup();
  await history.append(turn(1, "First line.\nSecond line.\n"));
  const text = await Bun.file(join(root, CHAT_HISTORY_FILE)).text();
  expect(text).toStartWith("# Specquer's chat history");
  expect(text).toContain("text: |\n");
  expect(text).toContain("        First line.\n        Second line.\n");
  expect(await Bun.file(join(root, ".specquer/user/.gitignore")).text()).toBe("*\n");
});

test("keeps the last 200 turns", async () => {
  const { root, history } = await setup();
  const many = Array.from({ length: 201 }, (_, i) => turn(i + 1));
  await Bun.write(join(root, CHAT_HISTORY_FILE), JSON.stringify({ version: 1, turns: many }));
  await history.append(turn(202));
  const turns = await history.read();
  expect(turns).toHaveLength(200);
  expect(turns[0]!.question.text).toBe("Question 3?");
});

test("clear returns the turns, and restore puts them back in front of turns added since", async () => {
  const { history } = await setup();
  await history.append(turn(1));
  await history.append(turn(2));
  const cleared = await history.clear();
  expect(cleared).toEqual([turn(1), turn(2)]);
  expect(await history.read()).toEqual([]);
  await history.append(turn(3));
  expect(await history.restore(cleared)).toEqual([turn(1), turn(2), turn(3)]);
  expect(await history.read()).toEqual([turn(1), turn(2), turn(3)]);
});

test("invalid turns are dropped one by one; a file that isn't YAML is moved aside", async () => {
  const { root, history, warnings } = await setup();
  await Bun.write(join(root, CHAT_HISTORY_FILE), `version: 1\nturns:\n  - question: nope\n  - ${JSON.stringify(turn(1))}\n`);
  expect(await history.read()).toEqual([turn(1)]);
  await Bun.write(join(root, CHAT_HISTORY_FILE), "turns: [unclosed\n");
  expect(await history.read()).toEqual([]);
  expect(warnings[0]).toContain("moved to");
  expect(await Bun.file(join(root, `${CHAT_HISTORY_FILE}.damaged-1234`)).exists()).toBe(true);
  await history.append(turn(2));
  expect(await history.read()).toEqual([turn(2)]);
});
