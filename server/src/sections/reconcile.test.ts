import { describe, expect, test } from "bun:test";
import { type SectionData, emptyData, emptyPrefixData } from "./data.ts";
import { type ScannedDocument, reconcile } from "./reconcile.ts";

const KNOWN = new Set(["REQ", "SPEC"]);

function uids() {
  let n = 0;
  return () => `new${++n}`;
}

/** Data files: documents by ID, live sections by UID, retired sections by UID. */
function data(
  documents: Record<string, string>,
  sections: Record<string, [id: string, documentId: string]>,
  lastSequence = 0,
  retired: Record<string, string> = {},
): SectionData {
  const result = emptyData();
  for (const [id, path] of Object.entries(documents)) result.documents.set(id, { path });
  const ensure = (id: string) => {
    const prefix = id.split("-")[0]!;
    const prefixData = result.prefixes.get(prefix) ?? emptyPrefixData(lastSequence);
    result.prefixes.set(prefix, prefixData);
    return prefixData;
  };
  for (const [uid, [id, documentId]] of Object.entries(sections)) ensure(id).sections.set(uid, { id, documentId });
  for (const [uid, id] of Object.entries(retired)) ensure(id).retired.set(uid, { id });
  return result;
}

/**
 * A scanned document: its root section (`ID/uid`, the UID being the document ID) and its other
 * sections, each `ID`, `ID/uid` or `null` (no anchor or a placeholder).
 */
function doc(path: string, root: string | null, ...sections: Array<string | null>): ScannedDocument {
  const section = (s: string | null) => {
    if (s === null) return { id: null, uid: null };
    const [id, uid] = s.split("/");
    return { id: id === "" ? null : id!, uid: uid ?? null };
  };
  return { path, sections: [section(root), ...sections.map(section)] };
}

const docs = (d: SectionData) => Object.fromEntries([...d.documents].map(([id, e]) => [id, e.path]));
const sections = (d: SectionData, prefix = "REQ") =>
  Object.fromEntries([...(d.prefixes.get(prefix)?.sections ?? [])].map(([uid, e]) => [uid, `${e.id}@${e.documentId}`]));
const retired = (d: SectionData, prefix = "REQ") => Object.fromEntries([...(d.prefixes.get(prefix)?.retired ?? [])].map(([uid, e]) => [uid, e.id]));
const fix = (r: ReturnType<typeof reconcile>, path: string) => r.fixes.get(path)!;
const renumbered = (r: ReturnType<typeof reconcile>, path: string) => Object.fromEntries(fix(r, path).renumber);
const newUids = (r: ReturnType<typeof reconcile>, path: string) => Object.fromEntries(fix(r, path).uids);

describe("documents", () => {
  test("a new document gets a new ID; one without an ID gets the ID recorded for its path", () => {
    const r = reconcile(data({ d1: "a.md" }, {}), [doc("a.md", null), doc("b.md", null)], KNOWN, uids());
    expect(fix(r, "a.md").documentId).toBe("d1");
    expect(fix(r, "b.md").documentId).toBe("new1");
    expect(newUids(r, "a.md")).toEqual({ 0: "d1" });
    expect(docs(r.data)).toEqual({ d1: "a.md", new1: "b.md" });
  });

  test("the root section is recorded under the document ID", () => {
    const r = reconcile(emptyData(), [doc("a.md", "REQ-00001/d1")], KNOWN, uids());
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1" });
    expect(newUids(r, "a.md")).toEqual({});
  });

  test("a moved document keeps its ID and its path is updated", () => {
    const before = data({ d1: "old.md" }, { d1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] });
    const r = reconcile(before, [doc("new.md", "REQ-00001/d1", "REQ-00002/s2")], KNOWN, uids());
    expect(docs(r.data)).toEqual({ d1: "new.md" });
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1", s2: "REQ-00002@d1" });
    expect(renumbered(r, "new.md")).toEqual({});
  });

  test("a copy gets a new document ID and all its sections are renumbered", () => {
    const before = data({ d1: "b.md" }, { d1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] });
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1", "REQ-00002/s2"), doc("b.md", "REQ-00001/d1", "REQ-00002/s2")], KNOWN, uids());
    expect(fix(r, "b.md").documentId).toBe("d1");
    expect(fix(r, "a.md").documentId).toBe("new1");
    expect(renumbered(r, "a.md")).toEqual({ 0: "copy", 1: "copy" });
    expect(newUids(r, "a.md")).toEqual({ 0: "new1", 1: "new2" });
    expect(renumbered(r, "b.md")).toEqual({});
    expect(r.duplicates).toEqual([]);
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1", s2: "REQ-00002@d1" });
  });

  test("a copy with no file at the recorded path: the first by path keeps the ID", () => {
    const r = reconcile(data({ d1: "gone.md" }, {}), [doc("b.md", "/d1"), doc("a.md", "/d1")], KNOWN, uids());
    expect(fix(r, "a.md").documentId).toBe("d1");
    expect(fix(r, "b.md").documentId).toBe("new1");
    expect(docs(r.data)).toEqual({ d1: "a.md", new1: "b.md" });
  });

  test("documents no file holds are removed and their sections retired", () => {
    const before = data({ d1: "a.md", d2: "b.md" }, { d1: ["REQ-00001", "d1"], d2: ["REQ-00002", "d2"], s3: ["REQ-00003", "d2"] }, 5);
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1")], KNOWN, uids());
    expect(docs(r.data)).toEqual({ d1: "a.md" });
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1" });
    expect(retired(r.data)).toEqual({ d2: "REQ-00002", s3: "REQ-00003" });
    expect(r.data.prefixes.get("REQ")!.lastSequence).toBe(5);
  });

  test("the ID recorded for a path isn't reused when another file holds it", () => {
    const r = reconcile(data({ d1: "a.md" }, {}), [doc("a.md", null), doc("moved.md", "/d1")], KNOWN, uids());
    expect(fix(r, "a.md").documentId).toBe("new1");
    expect(docs(r.data)).toEqual({ d1: "moved.md", new1: "a.md" });
  });
});

describe("sections", () => {
  test("a section without a UID takes the one recorded for its ID; a new one gets a new UID", () => {
    const before = data({ d1: "a.md" }, { d1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] });
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1", "REQ-00002", "REQ-00007", null)], KNOWN, uids());
    expect(newUids(r, "a.md")).toEqual({ 1: "s2", 2: "new2", 3: "new1" });
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1", s2: "REQ-00002@d1", new2: "REQ-00007@d1" });
  });

  test("an edited ID is put back", () => {
    const before = data({ d1: "a.md" }, { d1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] });
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1", "REQ-00009/s2")], KNOWN, uids());
    expect(Object.fromEntries(fix(r, "a.md").restore)).toEqual({ 1: "REQ-00002" });
    expect(renumbered(r, "a.md")).toEqual({});
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1", s2: "REQ-00002@d1" });
    // An edited root ID too
    const root = reconcile(before, [doc("a.md", "REQ-00005/d1", "REQ-00002/s2")], KNOWN, uids());
    expect(Object.fromEntries(fix(root, "a.md").restore)).toEqual({ 0: "REQ-00001" });
  });

  test("an edited ID stays when another section now holds the recorded ID", () => {
    const before = data({ d1: "a.md" }, { d1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] });
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1", "REQ-00009/s2", "REQ-00002/s3")], KNOWN, uids());
    expect(fix(r, "a.md").restore.size).toBe(0);
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1", s2: "REQ-00009@d1", s3: "REQ-00002@d1" });
  });

  test("a copy within a document: the first occurrence keeps the ID, the copy is renumbered with a new UID", () => {
    const before = data({ d1: "a.md" }, { d1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] });
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1", "REQ-00002/s2", "REQ-00002/s2", "REQ-00002")], KNOWN, uids());
    expect(renumbered(r, "a.md")).toEqual({ 2: "copy", 3: "copy" });
    expect(newUids(r, "a.md")).toEqual({ 2: "new1", 3: "new2" });
    expect(r.duplicates).toEqual([]);
  });

  test("a copy pasted above the original: the recorded UID wins over position", () => {
    const before = data({ d1: "a.md" }, { d1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] });
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1", "REQ-00002", "REQ-00002/s2")], KNOWN, uids());
    expect(renumbered(r, "a.md")).toEqual({ 1: "copy" });
  });

  test("a copy across documents waits for the user; a requested occurrence is renumbered with a new UID", () => {
    const before = data({ d1: "a.md", d2: "b.md" }, { d1: ["REQ-00001", "d1"], d2: ["REQ-00002", "d2"], s3: ["REQ-00007", "d2"] });
    const scanned = [doc("a.md", "REQ-00001/d1", "REQ-00007/s3"), doc("b.md", "REQ-00002/d2", "REQ-00007/s3")];
    const r = reconcile(before, scanned, KNOWN, uids());
    expect(renumbered(r, "a.md")).toEqual({});
    expect(r.duplicates).toEqual([
      {
        id: "REQ-00007",
        kind: "duplicate",
        occurrences: [
          { path: "b.md", index: 1, keeps: true },
          { path: "a.md", index: 1, keeps: false },
        ],
      },
    ]);
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1", d2: "REQ-00002@d2", s3: "REQ-00007@d2" });
    const asked = reconcile(before, scanned, KNOWN, uids(), [{ path: "a.md", index: 1 }]);
    expect(renumbered(asked, "a.md")).toEqual({ 1: "duplicate" });
    expect(newUids(asked, "a.md")).toEqual({ 1: "new1" });
    expect(asked.duplicates).toEqual([]);
    // Asking for the keeper hands the ID to the other occurrence
    const keeper = reconcile(before, scanned, KNOWN, uids(), [{ path: "b.md", index: 1 }]);
    expect(renumbered(keeper, "b.md")).toEqual({ 1: "duplicate" });
    expect(renumbered(keeper, "a.md")).toEqual({});
  });

  test("a collision (different UIDs) waits for the user; a requested occurrence keeps its UID", () => {
    const before = data({ d1: "a.md", d2: "b.md" }, { d1: ["REQ-00001", "d1"], d2: ["REQ-00002", "d2"], s3: ["REQ-00008", "d1"], s4: ["REQ-00008", "d2"] });
    const scanned = [doc("a.md", "REQ-00001/d1", "REQ-00008/s3"), doc("b.md", "REQ-00002/d2", "REQ-00008/s4")];
    const r = reconcile(before, scanned, KNOWN, uids());
    expect(r.duplicates.map((d) => [d.kind, d.occurrences.map((o) => `${o.path}:${o.keeps}`)])).toEqual([["collision", ["a.md:true", "b.md:false"]]]);
    const asked = reconcile(before, scanned, KNOWN, uids(), [{ path: "b.md", index: 1 }]);
    expect(renumbered(asked, "b.md")).toEqual({ 1: "collision" });
    expect(newUids(asked, "b.md")).toEqual({});
  });

  test("a collision within one document also waits", () => {
    const r = reconcile(emptyData(), [doc("a.md", "REQ-00001/d1", "REQ-00008/s3", "REQ-00008/s4")], KNOWN, uids());
    expect(renumbered(r, "a.md")).toEqual({});
    expect(r.duplicates.map((d) => d.kind)).toEqual(["collision"]);
  });

  test("a copied UID: the occurrence with the recorded ID keeps it, the others get new UIDs", () => {
    const before = data({ d1: "a.md" }, { d1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] });
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1", "REQ-00009/s2", "REQ-00002/s2")], KNOWN, uids());
    expect(fix(r, "a.md").restore.size).toBe(0);
    expect(newUids(r, "a.md")).toEqual({ 1: "new1" });
    expect([...fix(r, "a.md").uidReplaced]).toEqual([1]);
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1", s2: "REQ-00002@d1", new1: "REQ-00009@d1" });
  });

  test("a retired ID back with its UID is restored; with another UID or none it is reused and renumbered", () => {
    const before = data({ d1: "a.md" }, { d1: ["REQ-00001", "d1"] }, 9, { s5: "REQ-00005", s6: "REQ-00006" });
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1", "REQ-00005/s5", "REQ-00006/other", "REQ-00006")], KNOWN, uids());
    expect(renumbered(r, "a.md")).toEqual({ 2: "reused", 3: "reused" });
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1", s5: "REQ-00005@d1" });
    expect(retired(r.data)).toEqual({ s6: "REQ-00006" });
  });

  test("unknown prefixes are renumbered; new IDs get entries; vanished sections are retired", () => {
    const before = data({ d1: "a.md" }, { d1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"], s3: ["REQ-00003", "d1"] });
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1", "XYZ-00001/x1", "REQ-00002/s2", "REQ-00010/s10", "SPEC-00004/s4")], KNOWN, uids());
    expect(renumbered(r, "a.md")).toEqual({ 1: "unknown-prefix" });
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1", s2: "REQ-00002@d1", s10: "REQ-00010@d1" });
    expect(retired(r.data)).toEqual({ s3: "REQ-00003" });
    expect(sections(r.data, "SPEC")).toEqual({ s4: "SPEC-00004@d1" });
    expect(r.data.prefixes.has("XYZ")).toBe(false);
  });

  test("a section moved to another document keeps its entry", () => {
    const before = data({ d1: "a.md", d2: "b.md" }, { d1: ["REQ-00001", "d1"], d2: ["REQ-00002", "d2"], s3: ["REQ-00003", "d1"] });
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1"), doc("b.md", "REQ-00002/d2", "REQ-00003/s3")], KNOWN, uids());
    expect(sections(r.data)).toEqual({ d1: "REQ-00001@d1", d2: "REQ-00002@d2", s3: "REQ-00003@d2" });
    expect(retired(r.data)).toEqual({});
  });

  test("merge leftovers: several entries for one ID, the one in the occurrence's document wins", () => {
    const before = data(
      { d1: "a.md", d2: "b.md" },
      { d1: ["REQ-00001", "d1"], d2: ["REQ-00002", "d2"], s1: ["REQ-00003", "d9"], s2: ["REQ-00003", "d2"], s3: ["REQ-00003", "d1"] },
    );
    const r = reconcile(before, [doc("a.md", "REQ-00001/d1", "REQ-00003"), doc("b.md", "REQ-00002/d2", "REQ-00003")], KNOWN, uids());
    expect(r.duplicates[0]!.occurrences.find((o) => o.keeps)?.path).toBe("b.md");
  });

  test("a frozen document counts its sections but gets no fixes", () => {
    const before = data({ d1: "a.md" }, { d1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] }, 2);
    const frozen = { ...doc("a.md", "REQ-00001/d1", "REQ-00002/s2", "REQ-00012/x", "REQ-00012/y", null), frozen: true };
    const r = reconcile(before, [frozen], KNOWN, uids());
    expect(renumbered(r, "a.md")).toEqual({});
    expect(newUids(r, "a.md")).toEqual({});
    expect(r.duplicates).toEqual([]);
    expect(retired(r.data)).toEqual({});
    expect(r.data.prefixes.get("REQ")!.lastSequence).toBe(12);
  });

  test("lastSequence is the highest number known, retired ones included", () => {
    const before = data({ d1: "a.md" }, { d1: ["REQ-00004", "d1"] }, 2, { s9: "REQ-00030" });
    const r = reconcile(before, [doc("a.md", "REQ-00004/d1", "REQ-00009/x")], KNOWN, uids());
    expect(r.data.prefixes.get("REQ")!.lastSequence).toBe(30);
    const stored = reconcile(data({}, { d1: ["REQ-00001", "d1"] }, 40), [doc("a.md", "REQ-00001/d1")], KNOWN, uids());
    expect(stored.data.prefixes.get("REQ")!.lastSequence).toBe(40);
  });

  test("is stable", () => {
    const scanned = [doc("a.md", null, "REQ-00001", "REQ-00001"), doc("b.md", "/d1", "REQ-00002/u2")];
    const first = reconcile(emptyData(), scanned, KNOWN, uids());
    const second = reconcile(first.data, scanned, KNOWN, uids());
    expect(docs(second.data)).toEqual(docs(first.data));
    expect(sections(second.data)).toEqual(sections(first.data));
  });
});
