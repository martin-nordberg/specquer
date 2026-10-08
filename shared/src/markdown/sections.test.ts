import { describe, expect, test } from "bun:test";
import {
  type FoundSection,
  analyzeBody,
  anchorEdits,
  anchorTagSectionId,
  applyEdits,
  findSections,
  hasConflictMarkers,
  isAnchorCloseTag,
  rootAnchorText,
} from "./sections.ts";

const DOC = "tz4a98xxat96";

/**
 * Gives every section without an ID the next of `ids` and every section without a UID the next
 * of u1, u2, … (the root: `documentId`), applies the edits, returns the new body.
 */
function anchor(body: string, ids: string[] = [], documentId = DOC, renumber: Record<number, string> = {}): string {
  const sections = findSections(body);
  const plan = new Map<number, string>(Object.entries(renumber).map(([i, id]) => [Number(i), id]));
  const uids = new Map<number, string>();
  const queue = [...ids];
  let uid = 0;
  sections.forEach((section, index) => {
    if (section.id === null && !plan.has(index)) {
      const id = queue.shift();
      if (id === undefined) throw new Error(`Not enough IDs for ${body}`);
      plan.set(index, id);
    }
    if (index === 0) {
      if (section.uid !== documentId) uids.set(0, documentId);
    } else if (section.uid === null || plan.has(index)) uids.set(index, `u${++uid}`);
  });
  return applyEdits(body, anchorEdits(body, sections, { ids: plan, uids }));
}

const summary = (sections: FoundSection[]) => sections.map((s) => `${s.kind}:${s.id ?? "-"}:${s.title}`);

describe("findSections", () => {
  test("root, ATX heading, setext heading, inline heading form and list items", () => {
    const body = [
      `<a id="REQ-00001" data-uid="${DOC}"></a>`,
      "",
      '<a id="REQ-00002"></a>',
      "# Title",
      "",
      '<a id="REQ-00003"></a> Setext',
      "======",
      "",
      '## <a id="REQ-00004"></a> Inline',
      "",
      '* <a id="REQ-00005"></a> First item',
      "* Second item with quite a few more words than the title keeps",
      '- [ ] <a id="REQ-00006"></a> A task',
      "",
    ].join("\n");
    const sections = findSections(body);
    expect(summary(sections)).toEqual([
      "root:REQ-00001:",
      "heading:REQ-00002:Title",
      "heading:REQ-00003:Setext",
      "heading:REQ-00004:Inline",
      "item:REQ-00005:First item",
      "item:-:Second item with quite a few more words …",
      "item:REQ-00006:A task",
    ]);
    expect(sections[0]!.uid).toBe(DOC);
    expect(sections[1]!.uid).toBeNull();
    expect(sections[1]!.depth).toBe(1);
  });

  test("a blank line between anchor and heading is allowed", () => {
    const body = `<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002"></a>\n\n## Title\n`;
    expect(summary(findSections(body))).toEqual(["root:RQ-00001:", "heading:RQ-00002:Title"]);
  });

  test("anchors in code, block quotes and nested lists are ignored", () => {
    const body = [
      "```",
      '<a id="RQ-00001"></a>',
      "# Not a heading",
      "```",
      "",
      '> <a id="RQ-00002"></a>',
      "> # Quoted",
      "",
      "* plain",
      '  * <a id="RQ-00003"></a> nested',
      "",
    ].join("\n");
    expect(summary(findSections(body))).toEqual(["root:-:"]);
  });

  test("lists without anchors aren't sectioned", () => {
    expect(summary(findSections("* a\n* b\n"))).toEqual(["root:-:"]);
  });

  test("anchors with other IDs in a section's place are placeholders", () => {
    const body = '<a id=""></a>\n\nText\n\n<a id="new"></a>\n# Heading\n\n* <a id="x"></a> item\n* other\n';
    const sections = findSections(body);
    expect(summary(sections)).toEqual(["root:-:", "heading:-:Heading", "item:-:item", "item:-:other"]);
    expect(sections.map((s) => s.anchor !== undefined)).toEqual([true, true, true, false]);
  });

  test("other anchors are left alone", () => {
    const body = '# Alpha <a name="r7k2" data-status="draft"></a>\n\nText <a id="REQ-00001"></a> inline.\n';
    const sections = findSections(body);
    expect(summary(sections)).toEqual(["root:-:", "heading:-:Alpha"]);
    expect(sections[1]!.anchor).toBeUndefined();
  });

  test("a first anchor directly before a heading is the heading's, unless its UID is a document's", () => {
    const body = `<a id="RQ-00001" data-uid="${DOC}"></a>\n# Title\n`;
    expect(summary(findSections(body))).toEqual(["root:-:", "heading:RQ-00001:Title"]);
    expect(summary(findSections(body, { isDocumentUid: (uid) => uid === DOC }))).toEqual(["root:RQ-00001:", "heading:-:Title"]);
    // The heading's new anchor goes between the two, with a blank line, restoring the layout
    const restored = applyEdits(body, anchorEdits(body, findSections(body, { isDocumentUid: () => true }), { ids: new Map([[1, "RQ-00002"]]), uids: new Map([[1, "u1"]]) }));
    expect(restored).toBe(`<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002" data-uid="u1"></a>\n# Title\n`);
    expect(summary(findSections(restored))).toEqual(["root:RQ-00001:", "heading:RQ-00002:Title"]);
  });

  test("placeholders and invalid UIDs have no UID", () => {
    const sections = findSections('<a id="" data-uid="abcdef"></a>\n\n<a id="RQ-00002" data-uid="Bad-UID"></a>\n## A\n');
    expect(sections.map((s) => s.uid)).toEqual([null, null]);
  });

  test("a first anchor without a blank line before a heading", () => {
    expect(summary(findSections('<a id="RQ-00001"></a>\n# Title\n'))).toEqual(["root:-:", "heading:RQ-00001:Title"]);
    expect(summary(findSections('<a id="RQ-00001"></a>\n\n<a id="RQ-00002"></a>\n# Title\n'))).toEqual([
      "root:RQ-00001:",
      "heading:RQ-00002:Title",
    ]);
    expect(summary(findSections('<a id="RQ-00001"></a>\n\nText\n'))).toEqual(["root:RQ-00001:"]);
  });
});

describe("anchorEdits", () => {
  test("adds every missing anchor", () => {
    const body = "# Title\n\nText\n\n## Sub\nSetext\n---\n\n* <a id=\"\"></a> one\n* two\n";
    const result = anchor(body, ["RQ-00001", "RQ-00002", "RQ-00003", "RQ-00004", "RQ-00005", "RQ-00006"]);
    expect(result).toBe(
      `<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002" data-uid="u1"></a>\n# Title\n\nText\n\n<a id="RQ-00003" data-uid="u2"></a>\n## Sub\n` +
        '<a id="RQ-00004" data-uid="u3"></a> Setext\n---\n\n* <a id="RQ-00005" data-uid="u4"></a> one\n* <a id="RQ-00006" data-uid="u5"></a> two\n',
    );
    expect(summary(findSections(result))).toEqual([
      "root:RQ-00001:",
      "heading:RQ-00002:Title",
      "heading:RQ-00003:Sub",
      "heading:RQ-00004:Setext",
      "item:RQ-00005:one",
      "item:RQ-00006:two",
    ]);
  });

  test("an empty body gets its root anchor", () => {
    expect(anchor("", ["RQ-00001"])).toBe(rootAnchorText("RQ-00001", DOC));
    expect(findSections(rootAnchorText("RQ-00001", DOC))[0]!.id).toBe("RQ-00001");
  });

  test("a heading right after a paragraph gets a blank line before its anchor", () => {
    const result = anchor("Text\n# Title\n", ["RQ-00001", "RQ-00002"]);
    expect(result).toBe(`<a id="RQ-00001" data-uid="${DOC}"></a>\n\nText\n\n<a id="RQ-00002" data-uid="u1"></a>\n# Title\n`);
  });

  test("anchors go after a byte-order mark", () => {
    const result = anchor("\uFEFF# Title\n", ["RQ-00001", "RQ-00002"]);
    expect(result).toBe(`\uFEFF<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002" data-uid="u1"></a>\n# Title\n`);
    expect(findSections(result).map((s) => s.id)).toEqual(["RQ-00001", "RQ-00002"]);
  });

  test("a task item's anchor goes after the box", () => {
    const result = anchor(`<a id="RQ-00001" data-uid="${DOC}"></a>\n\n- [ ] <a id="RQ-00002" data-uid="aa"></a> a\n- [x] b\n`, ["RQ-00003"]);
    expect(result).toContain('- [x] <a id="RQ-00003" data-uid="u1"></a> b');
  });

  test("adds a missing UID after the ID and replaces a wrong one", () => {
    expect(anchor('<a id="RQ-00001"></a>\n\nText\n')).toBe(`<a id="RQ-00001" data-uid="${DOC}"></a>\n\nText\n`);
    expect(anchor('<a class="x" id="RQ-00001" data-uid="old"></a>\n\nText\n')).toBe(`<a class="x" id="RQ-00001" data-uid="${DOC}"></a>\n\nText\n`);
    // A data-document-id is no longer read, and is left as it is
    expect(anchor('<a id="RQ-00001" data-document-id="old"></a>\n\nText\n')).toBe(
      `<a id="RQ-00001" data-uid="${DOC}" data-document-id="old"></a>\n\nText\n`,
    );
  });

  test("renumbering and adding a UID at once", () => {
    expect(anchor(`<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00002"></a>\n# A\n`, [], DOC, { 1: "RQ-00007" })).toBe(
      `<a id="RQ-00001" data-uid="${DOC}"></a>\n\n<a id="RQ-00007" data-uid="u1"></a>\n# A\n`,
    );
  });

  test("renumbers and fills placeholders, keeping other attributes", () => {
    const body = `<a id='RQ-00001' class="x" data-uid="${DOC}"></a>\n\n<a id=new></a>\n# A\n`;
    expect(anchor(body, ["RQ-00009"], DOC, { 0: "RQ-00005" })).toBe(
      `<a id="RQ-00005" class="x" data-uid="${DOC}"></a>\n\n<a id="RQ-00009" data-uid="u1"></a>\n# A\n`,
    );
  });

  test("is stable: a second run makes no edits", () => {
    const bodies = [
      "# A\n\n## B\n\nC\n===\n\n* <a id=\"\"></a> x\n* y\n\n```\n# code\n```\n",
      "Intro\n# A\n> # quoted\n",
      '<a id="RQ-00001"></a>\n# Legacy\n',
      "- [ ] <a id=\"\"></a> task\n- [x] done\n",
    ];
    for (const body of bodies) {
      const ids = Array.from({ length: 20 }, (_, i) => `RQ-${String(i + 100).padStart(5, "0")}`);
      const once = anchor(body, ids);
      const sections = findSections(once);
      expect(sections.every((s) => s.id !== null)).toBe(true);
      expect(sections.every((s) => s.uid !== null)).toBe(true);
      expect(anchorEdits(once, sections, { ids: new Map(), uids: new Map() })).toEqual([]);
    }
  });
});

test("anchorTagSectionId", () => {
  expect(anchorTagSectionId('<a id="REQ-00001">')).toBe("REQ-00001");
  expect(anchorTagSectionId("<a id='REQ-00001' data-uid=\"x\">")).toBe("REQ-00001");
  expect(anchorTagSectionId('<a id="intro">')).toBeUndefined();
  expect(anchorTagSectionId('<a name="REQ-00001">')).toBeUndefined();
  expect(anchorTagSectionId("</a>")).toBeUndefined();
  expect(isAnchorCloseTag("</a>")).toBe(true);
});

describe("stray anchors", () => {
  test("anchors with section IDs outside section places are stray", () => {
    const body = [
      `<a id="RQ-00001" data-uid="${DOC}"></a>`,
      "",
      "Text <a id=\"RQ-00002\"></a> inline.",
      "",
      '<a id="RQ-00003"></a>',
      "# Heading",
      "",
      '> <a id="RQ-00004"></a>',
      "> # quoted",
      "",
      "* plain",
      '  * <a id="RQ-00005"></a> nested',
      "",
      "```",
      '<a id="RQ-00006"></a>',
      "```",
      "",
      '<a id="intro"></a> custom',
      "",
    ].join("\n");
    const { sections, strays } = analyzeBody(body);
    expect(sections.map((s) => s.id)).toEqual(["RQ-00001", "RQ-00003"]);
    expect(strays.map((s) => [s.id, s.line])).toEqual([
      ["RQ-00002", 3],
      ["RQ-00004", 8],
      ["RQ-00005", 12],
    ]);
    expect(body.slice(strays[0]!.from, strays[0]!.to)).toBe('<a id="RQ-00002"></a>');
  });

  test("lines and offsets count a byte-order mark", () => {
    const { strays } = analyzeBody('\uFEFFText\n\nMore <a id="RQ-00002"></a>\n');
    expect(strays.map((s) => s.line)).toEqual([3]);
    expect('\uFEFFText\n\nMore <a id="RQ-00002"></a>\n'.slice(strays[0]!.from, strays[0]!.to)).toBe('<a id="RQ-00002"></a>');
  });
});

test("hasConflictMarkers needs both ends of a conflict", () => {
  expect(hasConflictMarkers("a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> other\n")).toBe(true);
  expect(hasConflictMarkers("Title\n=======\n")).toBe(false);
  expect(hasConflictMarkers("<<<<<<< HEAD\nonly one end\n")).toBe(false);
  expect(hasConflictMarkers("text <<<<<<< not at line start\n>>>>>>>> eight\n")).toBe(false);
});
