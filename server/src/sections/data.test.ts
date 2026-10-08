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

  const sections = { lastSequence: 12, sections: new Map([["k1", { id: "REQ-00012", documentId: "zz1" }]]), retired: new Map() };
  const sectionsText = formatSectionsFile(sections);
  expect(sectionsText).toContain("lastSequence: 12\nsections:\n  k1: { id: REQ-00012, documentId: zz1 }\n");
  expect(sectionsText).not.toContain("retired");
  expect(parseSectionsFile(sectionsText, "REQ")).toEqual(sections);

  const withRetired = { ...sections, retired: new Map([["k9", { id: "REQ-00009" }]]) };
  const retiredText = formatSectionsFile(withRetired);
  expect(retiredText.endsWith("retired:\n  k9: { id: REQ-00009 }\n")).toBe(true);
  expect(parseSectionsFile(retiredText, "REQ")).toEqual(withRetired);
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

test("a section live on one side of a merge and retired on the other is live", () => {
  const text = [
    "lastSequence: 5",
    "sections:",
    "<<<<<<< HEAD",
    "  k1: { id: REQ-00001, documentId: d1 }",
    "=======",
    ">>>>>>> other",
    "retired:",
    "<<<<<<< HEAD",
    "=======",
    "  k1: { id: REQ-00001 }",
    "  k2: { id: REQ-00002 }",
    ">>>>>>> other",
    "",
  ].join("\n");
  const parsed = parseSectionsFile(text, "REQ");
  expect([...parsed.sections.keys()]).toEqual(["k1"]);
  expect([...parsed.retired]).toEqual([["k2", { id: "REQ-00002" }]]);
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
  data.prefixes.set("REQ", { lastSequence: 1, sections: new Map([["k1", { id: "REQ-00001", documentId: "d1" }]]), retired: new Map() });
  await files.write(data);
  const again = await new DataFiles(temp.root).read();
  expect(again).toEqual(data);
});

test("notices changes on disk, but not its own writes", async () => {
  const temp = await tempRoot();
  cleanups.push(temp.cleanup);
  const files = new DataFiles(temp.root);
  expect(await files.changed()).toBe(true);
  await files.read();
  expect(await files.changed()).toBe(false);
  const data = emptyData();
  data.documents.set("d1", { path: "a.md" });
  data.prefixes.set("REQ", { lastSequence: 1, sections: new Map([["d1", { id: "REQ-00001", documentId: "d1" }]]), retired: new Map() });
  await files.write(data);
  expect(await files.changed()).toBe(false);
  // A pull adds a prefix and changes a file
  await Bun.write(join(temp.root, ".specquer/shared/SPEC/sections.yaml"), "lastSequence: 3\nsections: {}\n");
  expect(await files.changed()).toBe(true);
  const read = await files.read();
  expect(read.prefixes.get("SPEC")?.lastSequence).toBe(3);
  expect(await files.changed()).toBe(false);
  await Bun.write(join(temp.root, ".specquer/shared/documents.yaml"), "documents:\n  d2: { path: b.md }\n");
  expect(await files.changed()).toBe(true);
  // A vanished file is written again even with unchanged content
  expect([...(await files.read()).documents.keys()]).toEqual(["d2"]);
  await Bun.$`rm ${join(temp.root, ".specquer/shared/REQ/sections.yaml")}`.quiet();
  await files.read();
  await files.write(data);
  expect(await Bun.file(join(temp.root, ".specquer/shared/REQ/sections.yaml")).exists()).toBe(true);
});
