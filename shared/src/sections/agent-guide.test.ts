import { expect, test } from "bun:test";
import { hasAgentGuide, withAgentGuide } from "./agent-guide.ts";

test("the guide is appended once, after a blank line, in the file's line endings", () => {
  const added = withAgentGuide("# Agents\n\nBe nice.\n\n\n");
  expect(added.startsWith("# Agents\n\nBe nice.\n\n<!-- specquer:section-anchors -->\n## Section anchors\n")).toBe(true);
  expect(added.endsWith("<!-- /specquer:section-anchors -->\n")).toBe(true);
  expect(hasAgentGuide(added)).toBe(true);
  expect(withAgentGuide(added)).toBe(added);
  expect(withAgentGuide("").startsWith("<!-- specquer:section-anchors -->\n")).toBe(true);
  const crlf = withAgentGuide("# A\r\n");
  expect(crlf.replace(/\r\n/g, "").includes("\n")).toBe(false);
});
