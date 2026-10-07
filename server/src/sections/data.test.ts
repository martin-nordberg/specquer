import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { tempRoot } from "../test-support.ts";
import { DataFiles, emptyData, formatDocumentsFile, formatSectionsFile, parseDocumentsFile, parseSectionsFile } from "./data.ts";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

test("one entry per line, in order, read back unchanged", () => {
  const documents = new Map([
    ["zz1", { path: "b.md" }],
    ["aa2", { path: "docs/a file: with, odd chars.md" }],
    ["mm3", { path: "true.md" }],
  ]);
  const text = formatDocumentsFile(documents);
  expect(text.split("\n").slice(1, 5)).toEqual([
    "documents:",
    "  zz1: { path: b.md }",
    '  aa2: { path: "docs/a file: with, odd chars.md" }',
    "  mm3: { path: true.md }",
  ]);
  expect([...parseDocumentsFile(text)]).toEqual([...documents]);

  const sections = { lastSequence: 12, sections: new Map([["k1", { id: "REQ-00012", documentId: "zz1" }]]) };
  const sectionsText = formatSectionsFile(sections);
  expect(sectionsText).toContain("lastSequence: 12\nsections:\n  k1: { id: REQ-00012, documentId: zz1 }\n");
  expect(parseSectionsFile(sectionsText, "REQ")).toEqual(sections);
});

test("merge conflicts keep both sides, the earlier entry first, and the highest lastSequence", () => {
  const text = [
    "lastSequence: 5",
    "sections:",
    "  k1: { id: REQ-00001, documentId: d1 }",
    "<<<<<<< HEAD",
    "  k2: { id: REQ-00005, documentId: d1 }",
    "=======",
    "  k3: { id: REQ-00005, documentId: d2 }",
    "  k2: { id: REQ-00004, documentId: d2 }",
    ">>>>>>> other",
    "",
  ].join("\n");
  const withSequences = text.replace("lastSequence: 5", "<<<<<<< HEAD\nlastSequence: 5\n=======\nlastSequence: 7\n>>>>>>> other");
  const parsed = parseSectionsFile(withSequences, "REQ");
  expect(parsed.lastSequence).toBe(7);
  expect([...parsed.sections]).toEqual([
    ["k1", { id: "REQ-00001", documentId: "d1" }],
    ["k2", { id: "REQ-00005", documentId: "d1" }],
    ["k3", { id: "REQ-00005", documentId: "d2" }],
  ]);
});

test("invalid entries are skipped and damaged files read as empty", () => {
  const parsed = parseSectionsFile("lastSequence: 3\nsections:\n  k1: { id: SPEC-00001, documentId: d1 }\n  k2: nope\n  k3: { id: REQ-00002, documentId: d1 }\n", "REQ");
  expect([...parsed.sections.keys()]).toEqual(["k3"]);
  expect(parseDocumentsFile(": : :\n\t- [").size).toBe(0);
});

test("writes only changed files and creates none for empty data", async () => {
  const temp = await tempRoot();
  cleanups.push(temp.cleanup);
  const files = new DataFiles(temp.root);
  await files.read();
  await files.write(emptyData());
  expect(await Bun.file(join(temp.root, ".specquer/shared/documents.yaml")).exists()).toBe(false);
  const data = emptyData();
  data.documents.set("d1", { path: "a.md" });
  data.prefixes.set("REQ", { lastSequence: 1, sections: new Map([["k1", { id: "REQ-00001", documentId: "d1" }]]) });
  await files.write(data);
  const again = await new DataFiles(temp.root).read();
  expect(again).toEqual(data);
});
