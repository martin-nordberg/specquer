import { expect, test } from "bun:test";
import { bodySections, headingPathAt } from "./body-sections";

const BODY = "Intro.\n\n# One\n\nText.\n\n## One.A\n\n# Two\n\n> # Quoted, not in the outline\n";

test("a body is parsed once however many ask, and again when it changes", () => {
  const first = bodySections(BODY);
  expect(bodySections(BODY)).toBe(first);
  expect(first.outline.sections.map((section) => section.title)).toEqual(["One", "Two"]);
  expect(first.sections.filter((section) => section.kind === "heading").map((section) => section.title)).toEqual(["One", "One.A", "Two"]);
  expect(bodySections(`${BODY}\n# Three\n`)).not.toBe(first);
});

test("the outline path of the last heading at or before an offset", () => {
  expect(headingPathAt(BODY, 0)).toBeNull();
  expect(headingPathAt(BODY, BODY.indexOf("Text."))).toBe("0");
  expect(headingPathAt(BODY, BODY.indexOf("## One.A"))).toBe("0.0");
  expect(headingPathAt(BODY, BODY.indexOf("# Two") + 3)).toBe("1");
  expect(headingPathAt(BODY, BODY.length)).toBe("1");
});
