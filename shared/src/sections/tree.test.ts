import { expect, test } from "bun:test";
import { sectionParents } from "./tree.ts";

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
