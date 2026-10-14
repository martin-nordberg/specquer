import { expect, test } from "bun:test";
import { analyzeBody } from "../markdown/sections.ts";
import { descendantsOf, sectionExtents, sectionParents } from "./tree.ts";

test("headings nest by level, list items belong to the heading above, and the root holds the rest", () => {
  const sections = [
    { kind: "root" as const },
    { kind: "item" as const },
    { kind: "heading" as const, depth: 2 },
    { kind: "heading" as const, depth: 3 },
    { kind: "item" as const },
    { kind: "heading" as const, depth: 3 },
    { kind: "heading" as const, depth: 1 },
    { kind: "heading" as const, depth: 2 },
  ];
  expect(sectionParents(sections)).toEqual([null, 0, 0, 2, 3, 2, 0, 6]);
});

/** Each section's extent as text, from a body. */
function extents(body: string): Map<string, string> {
  const sections = analyzeBody(body).sections.map((section) => ({ ...section, start: section.anchor?.from ?? section.insertAt }));
  const ranges = sectionExtents(sections, body.length);
  return new Map(sections.map((section, i) => [section.title, body.slice(ranges[i]!.from, ranges[i]!.to)]));
}

test("a section's extent runs from its anchor to the next section outside it", () => {
  const body = [
    '<a id="SPEC-00001" data-uid="aaaaaaaaaaaa"></a>',
    "",
    '<a id="SPEC-00005" data-uid="eeeeeeeeeeee"></a>',
    "# Title",
    "",
    "Intro.",
    "",
    '<a id="SPEC-00002" data-uid="bbbbbbbbbbbb"></a>',
    "## One",
    "",
    "One's text.",
    "",
    '<a id="SPEC-00003" data-uid="cccccccccccc"></a>',
    "### One.a",
    "",
    "- <a id=\"SPEC-00004\" data-uid=\"dddddddddddd\"></a>An item",
    "  - nested",
    "- another",
    "",
    "Two",
    "---",
    "",
    "Two's text.",
    "",
  ].join("\n");
  const found = extents(body);
  const [root, title, one, oneA, item, another, two] = ["", "Title", "One", "One.a", "An item", "another", "Two"].map((t) => found.get(t));
  expect(root).toBe(body);
  expect(title).toStartWith('<a id="SPEC-00005"');
  expect(title).toEndWith("Two's text.\n");
  expect(one).toStartWith('<a id="SPEC-00002"');
  // Subsections included, up to the next heading at the same level (a setext one)
  expect(one).toContain("### One.a");
  expect(one).toEndWith("- another\n\n");
  expect(oneA).toStartWith('<a id="SPEC-00003"');
  expect(item).toBe('- <a id="SPEC-00004" data-uid="dddddddddddd"></a>An item\n  - nested');
  // Every item of a sectioned list is a section
  expect(another).toBe("- another");
  expect(two).toStartWith("Two\n---");
});

test("descendantsOf lists every subsection, at every depth", () => {
  const parents = [null, 0, 1, 2, 1, 0];
  expect(descendantsOf(parents, 0)).toEqual([1, 2, 3, 4, 5]);
  expect(descendantsOf(parents, 1)).toEqual([2, 3, 4]);
  expect(descendantsOf(parents, 2)).toEqual([3]);
  expect(descendantsOf(parents, 5)).toEqual([]);
});
