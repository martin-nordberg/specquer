import { expect, test } from "bun:test";
import { normalizeKey, parsePrefixConfig } from "./config.ts";

const text = `prefixes:
  "documentation/notes/ideas.md": IDEA
  "documentation/notes/": NOTE
  "./documentation/": DOC
  "documentation/specifications/": SPEC
  "123": NUM
  bad/: req
  "*.md": GLOB
  "docs": NOEXT
  "/abs/": ABS
  "a/../b/": DOTS
  "./documentation/specifications/": DUP
`;

test("the longest matching key wins, whatever the key order", () => {
  const warnings: string[] = [];
  const config = parsePrefixConfig(text, (w) => warnings.push(w));
  expect(config.prefixFor("documentation/notes/a.md")).toBe("NOTE");
  expect(config.prefixFor("documentation/notes/deep/b.md")).toBe("NOTE");
  expect(config.prefixFor("documentation/notes/ideas.md")).toBe("IDEA");
  expect(config.prefixFor("documentation/specifications/x.md")).toBe("SPEC");
  expect(config.prefixFor("documentation/other.md")).toBe("DOC");
  expect(config.prefixFor("documentation/notes/a.txt")).toBeUndefined();
  expect(config.prefixFor("documentation-old/a.md")).toBeUndefined();
  expect(config.prefixFor("README.md")).toBeUndefined();
  expect(config.prefixFor("bad/x.md")).toBeUndefined();
  expect(warnings).toHaveLength(7);
  expect([...config.prefixes()]).toEqual(["IDEA", "NOTE", "DOC", "SPEC"]);
});

test("a file key matches only that file", () => {
  const config = parsePrefixConfig('prefixes:\n  "./README.md": TOP\n');
  expect(config.prefixFor("README.md")).toBe("TOP");
  expect(config.prefixFor("docs/README.md")).toBeUndefined();
});

test("normalizeKey removes leading ./ and rejects other keys", () => {
  expect(normalizeKey("./docs/")).toBe("docs/");
  expect(normalizeKey("././docs/a.md")).toBe("docs/a.md");
  expect(normalizeKey("./")).toBe("");
  expect(normalizeKey("docs")).toBeUndefined();
  expect(normalizeKey("docs//")).toBeUndefined();
  expect(normalizeKey("../docs/")).toBeUndefined();
  expect(normalizeKey("docs/*.md")).toBeUndefined();
});

test("./ sections every Markdown file", () => {
  const config = parsePrefixConfig('prefixes:\n  "./": REQ\n  "x/": XY\n');
  expect(config.prefixFor("a.md")).toBe("REQ");
  expect(config.prefixFor("y/z.md")).toBe("REQ");
  expect(config.prefixFor("x/y/z.md")).toBe("XY");
});

test("empty or invalid configuration sections nothing", () => {
  expect(parsePrefixConfig("").prefixFor("a.md")).toBeUndefined();
  expect(parsePrefixConfig("prefixes: [").prefixFor("a.md")).toBeUndefined();
});
