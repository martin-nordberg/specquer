import { describe, expect, test } from "bun:test";
import { type SectionData, emptyData } from "./data.ts";
import { type ScannedDocument, reconcile } from "./reconcile.ts";

const KNOWN = new Set(["REQ", "SPEC"]);

function uids() {
  let n = 0;
  return () => `new${++n}`;
}

function data(documents: Record<string, string>, sections: Record<string, [id: string, documentId: string]>, lastSequence = 0): SectionData {
  const result = emptyData();
  for (const [id, path] of Object.entries(documents)) result.documents.set(id, { path });
  for (const [uid, [id, documentId]] of Object.entries(sections)) {
    const prefix = id.split("-")[0]!;
    const prefixData = result.prefixes.get(prefix) ?? { lastSequence, sections: new Map() };
    prefixData.sections.set(uid, { id, documentId });
    result.prefixes.set(prefix, prefixData);
  }
  return result;
}

const doc = (path: string, documentId: string | null, ...sectionIds: Array<string | null>): ScannedDocument => ({ path, documentId, sectionIds });

const docs = (d: SectionData) => Object.fromEntries([...d.documents].map(([id, e]) => [id, e.path]));
const sections = (d: SectionData, prefix = "REQ") =>
  Object.fromEntries([...(d.prefixes.get(prefix)?.sections ?? [])].map(([uid, e]) => [uid, `${e.id}@${e.documentId}`]));
const renumbered = (r: ReturnType<typeof reconcile>, path: string) => [...r.fixes.get(path)!.renumber];

describe("documents", () => {
  test("a new document gets a new ID; one without an ID gets the ID recorded for its path", () => {
    const r = reconcile(data({ d1: "a.md" }, {}), [doc("a.md", null), doc("b.md", null)], KNOWN, uids());
    expect(r.fixes.get("a.md")!.documentId).toBe("d1");
    expect(r.fixes.get("b.md")!.documentId).toBe("new1");
    expect(docs(r.data)).toEqual({ d1: "a.md", new1: "b.md" });
  });

  test("a moved document keeps its ID and its path is updated", () => {
    const r = reconcile(data({ d1: "old.md" }, { s1: ["REQ-00001", "d1"] }), [doc("new.md", "d1", "REQ-00001")], KNOWN, uids());
    expect(docs(r.data)).toEqual({ d1: "new.md" });
    expect(sections(r.data)).toEqual({ s1: "REQ-00001@d1" });
    expect(renumbered(r, "new.md")).toEqual([]);
  });

  test("a copy gets a new document ID and its sections are renumbered", () => {
    const before = data({ d1: "b.md" }, { s1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] });
    const r = reconcile(before, [doc("a.md", "d1", "REQ-00001", "REQ-00002"), doc("b.md", "d1", "REQ-00001", "REQ-00002")], KNOWN, uids());
    expect(r.fixes.get("b.md")!.documentId).toBe("d1");
    expect(r.fixes.get("a.md")!.documentId).toBe("new1");
    expect(renumbered(r, "a.md")).toEqual([0, 1]);
    expect(renumbered(r, "b.md")).toEqual([]);
    expect(sections(r.data)).toEqual({ s1: "REQ-00001@d1", s2: "REQ-00002@d1" });
  });

  test("a copy with no file at the recorded path: the first by path keeps the ID", () => {
    const r = reconcile(data({ d1: "gone.md" }, {}), [doc("b.md", "d1"), doc("a.md", "d1")], KNOWN, uids());
    expect(r.fixes.get("a.md")!.documentId).toBe("d1");
    expect(r.fixes.get("b.md")!.documentId).toBe("new1");
    expect(docs(r.data)).toEqual({ d1: "a.md", new1: "b.md" });
  });

  test("documents no file holds are removed with their sections", () => {
    const r = reconcile(data({ d1: "a.md", d2: "b.md" }, { s1: ["REQ-00001", "d2"] }, 5), [doc("a.md", "d1")], KNOWN, uids());
    expect(docs(r.data)).toEqual({ d1: "a.md" });
    expect(sections(r.data)).toEqual({});
    expect(r.data.prefixes.get("REQ")!.lastSequence).toBe(5);
  });

  test("the ID recorded for a path isn't reused when another file holds it", () => {
    const r = reconcile(data({ d1: "a.md" }, {}), [doc("a.md", null), doc("moved.md", "d1")], KNOWN, uids());
    expect(r.fixes.get("a.md")!.documentId).toBe("new1");
    expect(docs(r.data)).toEqual({ d1: "moved.md", new1: "a.md" });
  });
});

describe("sections", () => {
  test("duplicates in one document: the first occurrence keeps the ID", () => {
    const r = reconcile(emptyData(), [doc("a.md", "d1", "REQ-00001", "REQ-00002", "REQ-00001")], KNOWN, uids());
    expect(renumbered(r, "a.md")).toEqual([2]);
    expect(sections(r.data)).toEqual({ new1: "REQ-00001@d1", new2: "REQ-00002@d1" });
  });

  test("duplicates across documents: the recorded document keeps the ID", () => {
    const r = reconcile(
      data({ d1: "a.md", d2: "b.md" }, { s1: ["REQ-00007", "d2"] }),
      [doc("a.md", "d1", "REQ-00007"), doc("b.md", "d2", "REQ-00007")],
      KNOWN,
      uids(),
    );
    expect(renumbered(r, "a.md")).toEqual([0]);
    expect(renumbered(r, "b.md")).toEqual([]);
  });

  test("duplicates across documents with no record: the first by path keeps the ID", () => {
    const r = reconcile(emptyData(), [doc("b.md", "d2", "REQ-00007"), doc("a.md", "d1", "REQ-00007")], KNOWN, uids());
    expect(renumbered(r, "a.md")).toEqual([]);
    expect(renumbered(r, "b.md")).toEqual([0]);
  });

  test("merge leftovers: several entries for one ID, the earliest matching one wins", () => {
    const r = reconcile(
      data({ d1: "a.md", d2: "b.md" }, { s1: ["REQ-00003", "d9"], s2: ["REQ-00003", "d2"], s3: ["REQ-00003", "d1"] }),
      [doc("a.md", "d1", "REQ-00003"), doc("b.md", "d2", "REQ-00003")],
      KNOWN,
      uids(),
    );
    expect(renumbered(r, "a.md")).toEqual([0]);
    expect(sections(r.data)).toEqual({ s2: "REQ-00003@d2" });
  });

  test("a section moved to another document keeps its entry", () => {
    const r = reconcile(
      data({ d1: "a.md", d2: "b.md" }, { s1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] }),
      [doc("a.md", "d1", "REQ-00001"), doc("b.md", "d2", "REQ-00002")],
      KNOWN,
      uids(),
    );
    expect(sections(r.data)).toEqual({ s1: "REQ-00001@d1", s2: "REQ-00002@d2" });
  });

  test("unknown prefixes are renumbered; new IDs get entries; vanished IDs are removed", () => {
    const r = reconcile(
      data({ d1: "a.md" }, { s1: ["REQ-00001", "d1"], s2: ["REQ-00002", "d1"] }),
      [doc("a.md", "d1", "XYZ-00001", "REQ-00002", null, "REQ-00010", "SPEC-00004")],
      KNOWN,
      uids(),
    );
    expect(renumbered(r, "a.md")).toEqual([0]);
    expect(sections(r.data)).toEqual({ s2: "REQ-00002@d1", new1: "REQ-00010@d1" });
    expect(sections(r.data, "SPEC")).toEqual({ new2: "SPEC-00004@d1" });
    expect(r.data.prefixes.has("XYZ")).toBe(false);
  });

  test("lastSequence is the highest number known", () => {
    const before = data({ d1: "a.md" }, { s1: ["REQ-00004", "d1"] }, 2);
    const r = reconcile(before, [doc("a.md", "d1", "REQ-00004", "REQ-00009", "REQ-00009")], KNOWN, uids());
    expect(r.data.prefixes.get("REQ")!.lastSequence).toBe(9);
    const stored = reconcile(data({}, { s1: ["REQ-00001", "d1"] }, 40), [doc("a.md", "d1", "REQ-00001")], KNOWN, uids());
    expect(stored.data.prefixes.get("REQ")!.lastSequence).toBe(40);
  });

  test("is stable", () => {
    const scanned = [doc("a.md", null, "REQ-00001", "REQ-00001"), doc("b.md", "d1", "REQ-00002")];
    const first = reconcile(emptyData(), scanned, KNOWN, uids());
    const second = reconcile(first.data, scanned, KNOWN, uids());
    expect(docs(second.data)).toEqual(docs(first.data));
    expect(sections(second.data)).toEqual(sections(first.data));
  });
});
