import { expect, test } from "bun:test";
import { LONG_LINE, hasLongLine, languageForFile } from "./languages.ts";

test("languages by extension, in any case, and by whole name, case included", () => {
  const cases: Array<[string, string | undefined]> = [
    ["server/src/index.ts", "typescript"],
    ["App.TSX", "typescript"],
    ["a.mjs", "javascript"],
    ["package.json", "json"],
    ["bun.lock", "json"],
    ["styles.scss", "scss"],
    ["page.html", "xml"],
    ["App.vue", "xml"],
    ["config.yml", "yaml"],
    ["README.markdown", "markdown"],
    ["notes.mdx", "markdown"],
    ["mise.toml", "ini"],
    [".editorconfig", "ini"],
    ["build.sh", "bash"],
    [".envrc", "bash"],
    ["main.py", "python"],
    ["Main.java", "java"],
    ["build.gradle.kts", "kotlin"],
    ["x.h", "c"],
    ["x.hpp", "cpp"],
    ["x.cs", "csharp"],
    ["x.go", "go"],
    ["x.rs", "rust"],
    ["Gemfile", "ruby"],
    ["Makefile", "makefile"],
    ["rules.mk", "makefile"],
    ["schema.graphql", "graphql"],
    ["fix.patch", "diff"],
    ["makefile", undefined],
    ["Dockerfile", undefined],
    ["notes.txt", undefined],
    ["LICENSE", undefined],
    [".gitignore", undefined],
  ];
  for (const [path, language] of cases) expect([path, languageForFile(path)]).toEqual([path, language]);
});

test("long lines", () => {
  expect(hasLongLine("short\nlines\n")).toBe(false);
  expect(hasLongLine(`a\n${"x".repeat(LONG_LINE)}\n`)).toBe(false);
  expect(hasLongLine(`a\n${"x".repeat(LONG_LINE + 1)}`)).toBe(true);
  expect(hasLongLine("")).toBe(false);
});
