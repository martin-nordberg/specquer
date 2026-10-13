import { expect, test } from "bun:test";
import { searchUnits } from "./units.ts";

test("a file is split into its preamble and its heading sections' lead text", () => {
  const text = "---\ntitle: X\n---\nIntro text.\n\n# One\n\nLead of one.\n\n## One A\n\nText A.\n\n# Two\n\nText two.\n";
  expect(searchUnits("docs/a.md", text)).toEqual([
    { ord: 0, outlinePath: "", title: "a.md", headings: [], text: "Intro text." },
    { ord: 1, outlinePath: "0", title: "One", headings: [], text: "Lead of one." },
    { ord: 2, outlinePath: "0.0", title: "One A", headings: ["One"], text: "Text A." },
    { ord: 3, outlinePath: "1", title: "Two", headings: [], text: "Text two." },
  ]);
});

test("front matter isn't indexed, and an empty preamble is no unit", () => {
  const units = searchUnits("a.md", "---\nsecret: yes\n---\n# Only\n\nBody.\n");
  expect(units.map((unit) => unit.text)).toEqual(["Body."]);
});

test("section anchors give anchor IDs, and are removed from the text", () => {
  const text =
    '<a id="SPEC-00001" data-uid="aaaaaaaaaaaa"></a>\n\n<a id="SPEC-00002" data-uid="bbbbbbbbbbbb"></a>\n# Title\n\nText.\n\n## Plain\n\nMore.\n';
  const units = searchUnits("a.md", text);
  expect(units.map((unit) => [unit.title, unit.anchorId, unit.text])).toEqual([
    ["Title", "SPEC-00002", "Text."],
    ["Plain", undefined, "More."],
  ]);
});

test("setext headings and a file without headings", () => {
  expect(searchUnits("a.md", "Title\n=====\n\nBody.\n").map((unit) => [unit.outlinePath, unit.title])).toEqual([["0", "Title"]]);
  expect(searchUnits("notes/n.md", "Just text.\n")).toEqual([{ ord: 0, outlinePath: "", title: "n.md", headings: [], text: "Just text." }]);
});
