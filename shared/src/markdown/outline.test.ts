import { describe, expect, test } from "bun:test";
import type { Element, Root, RootContent } from "hast";
import { buildOutline, sectionAtPath, summarizedAt, summaryStopCount, summaryStopName, type OutlineSection } from "./outline.ts";
import { markdownToHast } from "./preview.ts";
import { OUTLINE_PATH_PROPERTY, SUMMARY_TAG, summarizeTree } from "./summary-tree.ts";

const slice = (body: string, range: { from: number; to: number }) => body.slice(range.from, range.to);

function shape(sections: OutlineSection[]): unknown[] {
  return sections.map((s) => [s.depth, s.title, ...(s.children.length > 0 ? [shape(s.children)] : [])]);
}

describe("buildOutline", () => {
  test("nests sections by level, with their ranges", () => {
    const body = "Intro\n\n# A\n\nLead A\n\n## A1\n\nText\n\n## A2\n\n# B\n\nText B\n";
    const outline = buildOutline(body);
    expect(shape(outline.sections)).toEqual([[1, "A", [[2, "A1"], [2, "A2"]]], [1, "B"]]);
    expect(outline.levels).toEqual([1, 2]);
    expect(slice(body, outline.preamble)).toBe("Intro\n\n");
    const a = outline.sections[0]!;
    expect(slice(body, a.heading)).toBe("# A");
    expect(slice(body, a.range)).toBe("# A\n\nLead A\n\n## A1\n\nText\n\n## A2\n\n");
    expect(slice(body, a.lead)).toBe("\n\nLead A\n\n");
    expect(slice(body, a.children[1]!.range)).toBe("## A2\n\n");
    expect(slice(body, outline.sections[1]!.range)).toBe("# B\n\nText B\n");
    expect(slice(body, outline.sections[1]!.lead)).toBe("\n\nText B\n");
  });

  test("skipped and unused levels, and a document starting at h2", () => {
    const outline = buildOutline("# A\n\n### A.x\n\n## B\n\n#### C\n");
    expect(shape(outline.sections)).toEqual([[1, "A", [[3, "A.x"], [2, "B", [[4, "C"]]]]]]);
    expect(outline.levels).toEqual([1, 2, 3, 4]);
    const h2 = buildOutline("## One\n\n### Two\n\n## Three\n");
    expect(shape(h2.sections)).toEqual([[2, "One", [[3, "Two"]]], [2, "Three"]]);
    expect(h2.levels).toEqual([2, 3]);
    expect(h2.preamble).toEqual({ from: 0, to: 0 });
  });

  test("ignores headings in block quotes and lists, and code", () => {
    const outline = buildOutline("# A\n\n> # Quoted\n\n- # In a list\n\n```\n# code\n```\n");
    expect(shape(outline.sections)).toEqual([[1, "A"]]);
  });

  test("a heading's anchor on the line before belongs to its section", () => {
    const body = '<a id="ROOT-00001" data-uid="aaaaaaaaaaaa"></a>\n\nIntro\n\n<a id="REQ-00002" data-uid="bbbbbbbbbbbb"></a>\n# A\n\nText\n\n<a id="REQ-00003"></a>\n## B\n';
    const outline = buildOutline(body);
    const a = outline.sections[0]!;
    expect(slice(body, a.heading)).toBe('<a id="REQ-00002" data-uid="bbbbbbbbbbbb"></a>\n# A');
    expect(slice(body, outline.preamble)).toBe('<a id="ROOT-00001" data-uid="aaaaaaaaaaaa"></a>\n\nIntro\n\n');
    expect(slice(body, a.lead)).toBe("\n\nText\n\n");
    expect(slice(body, a.children[0]!.range)).toBe('<a id="REQ-00003"></a>\n## B\n');
  });

  test("setext headings and a byte-order mark", () => {
    const body = "﻿Title\n=====\n\nText\n\nSub\n---\n\nMore\n";
    const outline = buildOutline(body);
    expect(shape(outline.sections)).toEqual([[1, "Title", [[2, "Sub"]]]]);
    expect(slice(body, outline.sections[0]!.heading)).toBe("Title\n=====");
    expect(slice(body, outline.sections[0]!.children[0]!.range)).toBe("Sub\n---\n\nMore\n");
  });

  test("no headings", () => {
    const outline = buildOutline("Just text\n");
    expect(outline).toEqual({ preamble: { from: 0, to: 10 }, sections: [], levels: [] });
    expect(summaryStopCount(outline)).toBe(0);
  });
});

describe("stops", () => {
  test("one per level used, plus the full text and the whole document", () => {
    expect(summaryStopCount(buildOutline("# A\n## B\n### C\n"))).toBe(5);
    expect(summaryStopCount(buildOutline("## A\n### B\n"))).toBe(4);
    expect(summaryStopCount(buildOutline("# A\n### B\n"))).toBe(4);
    const outline = buildOutline("# A\n### B\n");
    expect([0, 1, 2, 3].map((stop) => summaryStopName(outline, stop))).toEqual([
      "Summarize document",
      "Summarize level 1 sections",
      "Summarize level 3 sections",
      "Full text",
    ]);
  });

  test("what each stop summarizes", () => {
    const body = "Intro\n\n# A\n\n## A1\n\n### A1a\n\n## A2\n\n# B\n\n### B-x\n";
    const outline = buildOutline(body);
    const at = (stop: number) => summarizedAt(outline, stop, body.length).map((s) => [s.path, s.headings.join(" > ")]);
    expect(at(4)).toEqual([]);
    expect(at(3)).toEqual([["0.0.0", "A > A1"], ["1.0", "B"]]);
    // Level 2: the h3 directly under B is deeper, so it is summarized too
    expect(at(2)).toEqual([["0.0", "A"], ["0.1", "A"], ["1.0", "B"]]);
    expect(at(1)).toEqual([["0", ""], ["1", ""]]);
    expect(summarizedAt(outline, 0, body.length)).toEqual([{ path: "", document: true, heading: null, range: { from: 0, to: body.length }, headings: [] }]);
    expect(sectionAtPath(outline, "0.1")?.title).toBe("A2");
    expect(sectionAtPath(outline, "3")).toBeUndefined();
  });
});

function topLevel(tree: Root): string[] {
  const text = (node: RootContent): string => (node.type === "text" ? node.value : "children" in node ? node.children.map(text).join("") : "");
  return tree.children
    .filter((child): child is Element => child.type === "element")
    .map((child) => (child.tagName === SUMMARY_TAG ? `summary:${String(child.properties.dataPath)}` : `${child.tagName}:${text(child).replace(/\s+/g, " ").trim()}`));
}

describe("summarizeTree", () => {
  // Anchors before headings are moved into the headings by the preview pipeline
  const body = [
    '<a id="REQ-00001" data-uid="aaaaaaaaaaaa"></a>',
    "",
    "Intro with a [ref][r] link[^1].",
    "",
    '<a id="REQ-00002" data-uid="bbbbbbbbbbbb"></a>',
    "# A",
    "",
    "Lead A",
    "",
    "## A1",
    "",
    "Text A1",
    "",
    "- list",
    "",
    "## A2",
    "",
    "Title",
    "-----",
    "",
    "Text",
    "",
    "[r]: https://example.com",
    "[^1]: A footnote.",
    "",
  ].join("\n");
  const outline = buildOutline(body);
  const tree = markdownToHast(body);
  const at = (stop: number) => topLevel(summarizeTree(tree, body, outline, summarizedAt(outline, stop, body.length)));

  test("filters the rendered document at every stop", () => {
    expect(outline.levels).toEqual([1, 2]);
    expect(at(3)).toEqual(["p:", "p:Intro with a ref link1.", "h1:A", "p:Lead A", "h2:A1", "p:Text A1", "ul:list", "h2:A2", "h2:Title", "p:Text", "section:Footnotes A footnote. ↩"]);
    expect(at(2)).toEqual(["p:", "p:Intro with a ref link1.", "h1:A", "p:Lead A", "h2:A1", "summary:0.0", "h2:A2", "summary:0.1", "h2:Title", "summary:0.2", "section:Footnotes A footnote. ↩"]);
    expect(at(1)).toEqual(["p:", "p:Intro with a ref link1.", "h1:A", "summary:0", "section:Footnotes A footnote. ↩"]);
    expect(at(0)).toEqual(["summary:"]);
  });

  test("marks headings with their outline paths and keeps links resolved", () => {
    const filtered = summarizeTree(tree, body, outline, summarizedAt(outline, 2, body.length));
    const headings = filtered.children.filter((c): c is Element => c.type === "element" && /^h\d$/.test(c.tagName));
    expect(headings.map((h) => h.properties[OUTLINE_PATH_PROPERTY])).toEqual(["0", "0.0", "0.1", "0.2"]);
    // The heading keeps its anchor, moved into it
    expect((headings[0]!.children[0] as Element).properties.id).toBe("user-content-REQ-00002");
    const link = (filtered.children.find((c): c is Element => c.type === "element" && c.tagName === "p" && c.children.length > 1)!).children.find((c): c is Element => c.type === "element" && c.tagName === "a");
    expect(link?.properties.href).toBe("https://example.com");
  });

  test("works with a byte-order mark", () => {
    const bom = "﻿# A\n\nText\n\n## B\n\nMore\n";
    const o = buildOutline(bom);
    expect(topLevel(summarizeTree(markdownToHast(bom), bom, o, summarizedAt(o, 2, bom.length)))).toEqual(["h1:A", "p:Text", "h2:B", "summary:0.0"]);
  });
});
