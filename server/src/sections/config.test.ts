import { expect, test } from "bun:test";
import { parsePrefixConfig } from "./config.ts";

const text = `prefixes:
  "documentation/notes/": NOTE
  "documentation/notes/ideas.md": IDEA
  "documentation/specifications/": SPEC
  "*.md": TOP
  "123": NUM
  bad/: req
`;

test("keys are matched last to first; a key ending in / matches the folder", () => {
  const warnings: string[] = [];
  const config = parsePrefixConfig(text, (w) => warnings.push(w));
  expect(config.prefixFor("documentation/notes/a.md")).toBe("NOTE");
  expect(config.prefixFor("documentation/notes/deep/b.md")).toBe("NOTE");
  expect(config.prefixFor("documentation/notes/ideas.md")).toBe("IDEA");
  expect(config.prefixFor("documentation/specifications/x.md")).toBe("SPEC");
  expect(config.prefixFor("README.md")).toBe("TOP");
  expect(config.prefixFor("documentation/other.md")).toBeUndefined();
  expect(config.prefixFor("documentation/notes/a.txt")).toBeUndefined();
  expect(config.prefixFor("bad/x.md")).toBeUndefined();
  expect(warnings).toHaveLength(1);
  expect([...config.prefixes()]).toEqual(["NOTE", "IDEA", "SPEC", "TOP", "NUM"]);
});

test("**/* sections every Markdown file", () => {
  const config = parsePrefixConfig('prefixes:\n  "**/*": REQ\n');
  expect(config.prefixFor("a.md")).toBe("REQ");
  expect(config.prefixFor("x/y/z.md")).toBe("REQ");
});

test("empty or invalid configuration sections nothing", () => {
  expect(parsePrefixConfig("").prefixFor("a.md")).toBeUndefined();
  expect(parsePrefixConfig("prefixes: [").prefixFor("a.md")).toBeUndefined();
});
