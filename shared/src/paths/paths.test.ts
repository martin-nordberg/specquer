import { describe, expect, test } from "bun:test";
import {
  checkName,
  checkPath,
  checkViewPath,
  hiddenPath,
  entryNameSchema,
  isMarkdownFile,
  isSameOrInside,
  markdownPathSchema,
  parentPath,
  relativePath,
  renamedPath,
  viewPathSchema,
} from "./paths.ts";

describe("checkPath", () => {
  test("normalizes harmless variations", () => {
    expect(checkPath("a//b/./c/")).toEqual({ ok: true, path: "a/b/c" });
    expect(checkPath("./docs/x.md")).toEqual({ ok: true, path: "docs/x.md" });
    expect(checkPath("")).toEqual({ ok: true, path: "" });
  });

  test.each(["../x.md", "a/../../x.md", "/etc/passwd", "C:/x.md", "a\\b.md", ".git/config", "a/.specquer/user/uistate.yaml", ".GIT/hooks", "a/.Specquer/shared", ".Git", "a\u0000b"])(
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

  test.each(["", " x", "x ", ".", "..", "a/b", "a\\b", ".git", ".specquer", ".GIT", ".SpecQuer", "x".repeat(256), "a\tb"])("rejects %p", (name) => {
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

test("relativePath", () => {
  expect(relativePath("a/b/c.md", "a/b/c.md")).toBe("");
  expect(relativePath("a/b/c.md", "a/b/d.md")).toBe("d.md");
  expect(relativePath("a/b/c.md", "a/x/d.md")).toBe("../x/d.md");
  expect(relativePath("c.md", "a/d.md")).toBe("a/d.md");
  expect(relativePath("a/b/c.md", "d.md")).toBe("../../d.md");
  expect(relativePath("a/c.md", "a/b/d.md")).toBe("b/d.md");
});

describe("viewing paths (Step 014)", () => {
  test("checkViewPath accepts the root's .specquer/shared/ only", () => {
    expect(checkViewPath(".specquer/shared/REQ/sections.yaml")).toEqual({ ok: true, path: ".specquer/shared/REQ/sections.yaml" });
    expect(checkViewPath("./src//index.ts")).toEqual({ ok: true, path: "src/index.ts" });
    expect(checkViewPath(".specquer/shared/")).toEqual({ ok: true, path: ".specquer/shared" });
    for (const path of [".specquer/user/instance.json", ".specquer/cache/search.db", ".SPECQUER/shared/x.yaml", ".specquer/Shared/x.yaml", ".specquer", "docs/.specquer/shared/x.yaml", ".specquer/shared/../user/x", ".git/config"]) {
      expect([path, checkViewPath(path).ok]).toEqual([path, false]);
    }
    expect(viewPathSchema.safeParse(".specquer/shared/agent.config.yaml").success).toBe(true);
    expect(viewPathSchema.safeParse(".specquer/user/approvals.yaml").success).toBe(false);
  });

  test("hiddenPath hides node_modules, .git and all of .specquer but the root's shared folder", () => {
    for (const path of ["node_modules/x/index.js", "web/node_modules/y.js", "NODE_MODULES/z", ".git/config", ".specquer/user/instance.json", ".specquer/cache/summaries.db", "docs/.specquer/shared/x.yaml", ".SPECQUER/shared/x.yaml"]) {
      expect([path, hiddenPath(path)]).toEqual([path, true]);
    }
    for (const path of ["src/index.ts", ".github/workflows/docs.yml", ".specquer", ".specquer/shared", ".specquer/shared/REQ/sections.yaml", "node_modules.md"]) {
      expect([path, hiddenPath(path)]).toEqual([path, false]);
    }
  });
});
