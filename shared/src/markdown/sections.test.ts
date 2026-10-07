import { describe, expect, test } from "bun:test";
import { type FoundSection, anchorEdits, anchorTagSectionId, applyEdits, findSections, isAnchorCloseTag, rootAnchorText } from "./sections.ts";

const DOC = "tz4a98xxat96iws9zmbrgj3a";

/** Gives every section without an ID the next of `ids`, applies the edits, returns the new body. */
function anchor(body: string, ids: string[] = [], documentId = DOC, renumber: Record<number, string> = {}): string {
  const sections = findSections(body);
  const plan = new Map<number, string>(Object.entries(renumber).map(([i, id]) => [Number(i), id]));
  const queue = [...ids];
  sections.forEach((section, index) => {
    if (section.id === null && !plan.has(index)) {
      const id = queue.shift();
      if (id === undefined) throw new Error(`Not enough IDs for ${body}`);
      plan.set(index, id);
    }
  });
  return applyEdits(body, anchorEdits(body, sections, { ids: plan, documentId }));
}

const summary = (sections: FoundSection[]) => sections.map((s) => `${s.kind}:${s.id ?? "-"}:${s.title}`);

describe("findSections", () => {
  test("root, ATX heading, setext heading, inline heading form and list items", () => {
    const body = [
      `<a id="REQ-00001" data-document-id="${DOC}"></a>`,
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
    expect(sections[0]!.anchor?.documentId).toBe(DOC);
    expect(sections[1]!.depth).toBe(1);
  });

  test("a blank line between anchor and heading is allowed", () => {
    const body = `<a id="RQ-00001" data-document-id="${DOC}"></a>\n\n<a id="RQ-00002"></a>\n\n## Title\n`;
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

  test("a legacy root anchor (no document ID) directly before a heading is the heading's", () => {
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
      `<a id="RQ-00001" data-document-id="${DOC}"></a>\n\n<a id="RQ-00002"></a>\n# Title\n\nText\n\n<a id="RQ-00003"></a>\n## Sub\n` +
        '<a id="RQ-00004"></a> Setext\n---\n\n* <a id="RQ-00005"></a> one\n* <a id="RQ-00006"></a> two\n',
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
    expect(result).toBe(`<a id="RQ-00001" data-document-id="${DOC}"></a>\n\nText\n\n<a id="RQ-00002"></a>\n# Title\n`);
  });

  test("anchors go after a byte-order mark", () => {
    const result = anchor("\uFEFF# Title\n", ["RQ-00001", "RQ-00002"]);
    expect(result).toBe(`\uFEFF<a id="RQ-00001" data-document-id="${DOC}"></a>\n\n<a id="RQ-00002"></a>\n# Title\n`);
    expect(findSections(result).map((s) => s.id)).toEqual(["RQ-00001", "RQ-00002"]);
  });

  test("a task item's anchor goes after the box", () => {
    const result = anchor(`<a id="RQ-00001" data-document-id="${DOC}"></a>\n\n- [ ] <a id="RQ-00002"></a> a\n- [x] b\n`, ["RQ-00003"]);
    expect(result).toContain("- [x] <a id=\"RQ-00003\"></a> b");
  });

  test("adds the document ID to a legacy root anchor and replaces a wrong one", () => {
    expect(anchor('<a id="RQ-00001"></a>\n\nText\n')).toBe(`<a id="RQ-00001" data-document-id="${DOC}"></a>\n\nText\n`);
    expect(anchor('<a id="RQ-00001" data-document-id="old"></a>\n\nText\n')).toBe(
      `<a id="RQ-00001" data-document-id="${DOC}"></a>\n\nText\n`,
    );
  });

  test("renumbers and fills placeholders, keeping other attributes", () => {
    const body = `<a id='RQ-00001' class="x" data-document-id="${DOC}"></a>\n\n<a id=new></a>\n# A\n`;
    expect(anchor(body, ["RQ-00009"], DOC, { 0: "RQ-00005" })).toBe(
      `<a id="RQ-00005" class="x" data-document-id="${DOC}"></a>\n\n<a id="RQ-00009"></a>\n# A\n`,
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
      expect(anchorEdits(once, sections, { ids: new Map(), documentId: DOC })).toEqual([]);
    }
  });
});

test("anchorTagSectionId", () => {
  expect(anchorTagSectionId('<a id="REQ-00001">')).toBe("REQ-00001");
  expect(anchorTagSectionId("<a id='REQ-00001' data-document-id=\"x\">")).toBe("REQ-00001");
  expect(anchorTagSectionId('<a id="intro">')).toBeUndefined();
  expect(anchorTagSectionId('<a name="REQ-00001">')).toBeUndefined();
  expect(anchorTagSectionId("</a>")).toBeUndefined();
  expect(isAnchorCloseTag("</a>")).toBe(true);
});
