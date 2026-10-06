import { describe, expect, test } from "bun:test";
import {
  checkName,
  checkPath,
  entryNameSchema,
  isMarkdownFile,
  isSameOrInside,
  markdownPathSchema,
  parentPath,
  renamedPath,
} from "./paths.ts";

describe("checkPath", () => {
  test("normalizes harmless variations", () => {
    expect(checkPath("a//b/./c/")).toEqual({ ok: true, path: "a/b/c" });
    expect(checkPath("./docs/x.md")).toEqual({ ok: true, path: "docs/x.md" });
    expect(checkPath("")).toEqual({ ok: true, path: "" });
  });

  test.each(["../x.md", "a/../../x.md", "/etc/passwd", "C:/x.md", "a\\b.md", ".git/config", "a/.specquer/user/uistate.yaml", "a\u0000b"])(
    "rejects %p",
    (path) => {
      expect(checkPath(path).ok).toBe(false);
    },
  );
});

describe("checkName", () => {
  test("accepts ordinary names", () => {
    expect(checkName("My spec.md").ok).toBe(true);
    expect(checkName(".hidden").ok).toBe(true);
  });

  test.each(["", " x", "x ", ".", "..", "a/b", "a\\b", ".git", ".specquer", "x".repeat(256), "a\tb"])("rejects %p", (name) => {
    expect(checkName(name).ok).toBe(false);
  });

  test("schema reports the reason", () => {
    const result = entryNameSchema.safeParse("a/b");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("/");
  });
});

test("markdown files", () => {
  expect(isMarkdownFile("a/b.md")).toBe(true);
  expect(isMarkdownFile("a/B.MD")).toBe(true);
  expect(isMarkdownFile("a/.md")).toBe(false);
  expect(isMarkdownFile("a/b.mdx")).toBe(false);
  expect(markdownPathSchema.safeParse("x.txt").success).toBe(false);
  expect(markdownPathSchema.parse("./a//x.md")).toBe("a/x.md");
});

test("path helpers", () => {
  expect(parentPath("a/b/c.md")).toBe("a/b");
  expect(parentPath("c.md")).toBe("");
  expect(isSameOrInside("a/b", "a")).toBe(true);
  expect(isSameOrInside("ab", "a")).toBe(false);
  expect(isSameOrInside("x", "")).toBe(true);
  expect(renamedPath("a/b/c.md", "a/b", "a/z")).toBe("a/z/c.md");
  expect(renamedPath("a/bc.md", "a/b", "a/z")).toBeUndefined();
});
