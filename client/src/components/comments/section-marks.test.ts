import { expect, test } from "bun:test";
import type { Element, Root } from "hast";
import { markdownToHast } from "@specquer/shared/markdown";
import { pipLabel, pipText } from "./markers";
import { hiddenCounts, markSections, shownAnchorUids } from "./section-marks";

const anchor = (id: string, uid: string) => `<a id="${id}" data-uid="${uid}"></a>`;
const BODY = `${anchor("REQ-00001", "rootrootroot")}\n\n${anchor("REQ-00002", "titletitleti")}\n# Title\n\nIntro.\n\n${anchor("REQ-00003", "subsubsubsub")}\n## Sub\n\n- ${anchor("REQ-00004", "itemitemitem")} An item\n- another\n`;

function marks(tree: Root): Array<[string, string | undefined]> {
  const found: Array<[string, string | undefined]> = [];
  const visit = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      found.push([child.tagName, child.properties.dataSectionUid as string | undefined]);
      visit(child);
    }
  };
  visit(tree);
  return found.filter(([tag]) => ["p", "h1", "h2", "ul", "li"].includes(tag));
}

test("blocks are marked with their sections, and sectioned list items with their own", () => {
  const tree = markdownToHast(BODY);
  // The preview puts a heading's anchor in the heading
  expect(marks(markSections(tree, BODY))).toEqual([
    ["p", "rootrootroot"],
    ["h1", "titletitleti"],
    ["p", "titletitleti"],
    ["h2", "subsubsubsub"],
    ["ul", "subsubsubsub"],
    ["li", "itemitemitem"],
    ["li", undefined],
  ]);
});

test("threads of hidden sections are counted on the nearest shown ancestor", () => {
  const counts = new Map([
    ["subsubsubsub", 2],
    ["itemitemitem", 1],
    ["titletitleti", 1],
  ]);
  expect(hiddenCounts(BODY, new Set(["rootrootroot", "titletitleti"]), counts)).toEqual(new Map([["titletitleti", 3]]));
  expect(hiddenCounts(BODY, new Set(["rootrootroot", "titletitleti", "subsubsubsub", "itemitemitem"]), counts).size).toBe(0);
  const tree: Root = { type: "root", children: [{ type: "element", tagName: "a", properties: { dataSectionAnchor: "", dataUid: "x1" }, children: [] }] };
  expect(shownAnchorUids(tree)).toEqual(new Set(["x1"]));
});

test("the pip's name and text", () => {
  expect(pipLabel(1, "open")).toBe("1 open comment thread");
  expect(pipLabel(2, "resolved")).toBe("2 resolved comment threads");
  expect(pipLabel(3, "all", 2)).toBe("3 comment threads, 2 in hidden sections");
  expect(pipText(3, 2)).toBe("3 (2 hidden)");
});
