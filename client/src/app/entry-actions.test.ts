import { expect, test } from "bun:test";
import type { TreeNode } from "@specquer/shared/api";
import { type EntryAction, entryName, notApplicable } from "./entry-actions";

const file = (path: string): TreeNode => ({ kind: "file", name: path.slice(path.lastIndexOf("/") + 1), path });
const folder = (path: string): TreeNode => ({ kind: "folder", name: path.slice(path.lastIndexOf("/") + 1), path, children: [] });
const all: EntryAction[] = ["new-file", "new-folder", "rename", "delete", "anchors", "settings", "problems"];

test("everything applies to Markdown files and ordinary folders, the root included", () => {
  for (const node of [file("docs/a.md"), folder("src"), folder("")]) {
    for (const action of all) expect([node.path, action, notApplicable(action, node)]).toEqual([node.path, action, undefined]);
  }
});

test("files other than Markdown: renamed and deleted outside Specquer, and without sections", () => {
  const ts = file("src/build.ts");
  expect(notApplicable("rename", ts)).toBe("Specquer renames and deletes only Markdown files. Rename “build.ts” outside Specquer.");
  expect(notApplicable("delete", ts)).toBe("Specquer renames and deletes only Markdown files. Delete “build.ts” outside Specquer.");
  expect(notApplicable("anchors", ts)).toBe("Only Markdown files have sections, so “build.ts” has none.");
  expect(notApplicable("problems", file("logo.png"))).toBe("Only Markdown files have sections, so “logo.png” has none.");
});

test("nothing applies in .specquer", () => {
  for (const node of [folder(".specquer"), folder(".specquer/shared"), file(".specquer/shared/REQ/sections.yaml")]) {
    for (const action of all) expect(notApplicable(action, node)).toBe("Everything in .specquer is Specquer's own data, which Specquer changes itself.");
  }
});

test("entry names", () => {
  expect(entryName(folder(""))).toBe("the root folder");
  expect(entryName(file("docs/login.md"))).toBe("“login.md”");
});
