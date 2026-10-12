import { expect, test } from "bun:test";
import { buildOutline, summarizedAt, summaryStopCount } from "../markdown/outline.ts";
import { summaryBody, summaryTargets } from "./targets.ts";

const BODY = "Intro.\n\n# Top\n\nLead.\n\n## A\n\nText a.\n\n### A1\n\nDeep.\n\n## B\n\nText b.\n\n# Second\n\n#### Skipped levels\n\nText.\n";

test("summaryBody drops the front matter and normalizes line endings", () => {
  expect(summaryBody("---\r\ntitle: T\r\n---\r\n# H\r\n\r\nText\r\n")).toBe("# H\n\nText\n");
  expect(summaryBody("# H\n")).toBe("# H\n");
});

test("every stop's sections are among the targets, with the same text and headings", () => {
  const outline = buildOutline(BODY);
  const targets = summaryTargets(BODY);
  const byPath = new Map(targets.map((target) => [target.path, target]));
  expect(targets).toHaveLength(new Set(targets.map((target) => target.path)).size);
  for (let stop = 0; stop < summaryStopCount(outline) - 1; stop++) {
    for (const section of summarizedAt(outline, stop, BODY.length)) {
      // What the preview sends: the saved body's slice and the headings above
      expect(byPath.get(section.path)).toMatchObject({ range: section.range, headings: section.headings, text: BODY.slice(section.range.from, section.range.to) });
    }
  }
});

test("deeper sections come first, the whole document last", () => {
  const targets = summaryTargets(BODY);
  const index = (path: string) => targets.findIndex((target) => target.path === path);
  expect(index("0.0.0")).toBeLessThan(index("0.0"));
  expect(index("0.0")).toBeLessThan(index("0"));
  expect(targets.at(-1)).toMatchObject({ path: "", document: true });
  expect(targets.map((target) => target.path).sort()).toEqual(["", "0", "0.0", "0.0.0", "0.1", "1", "1.0"].sort());
});

test("no targets without headings", () => {
  expect(summaryTargets("Just text.\n")).toEqual([]);
});
