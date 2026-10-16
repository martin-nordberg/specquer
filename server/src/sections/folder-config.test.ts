import { afterEach, describe, expect, test } from "bun:test";
import { utimes } from "node:fs/promises";
import { join } from "node:path";
import { FileService } from "../files.ts";
import { tempRoot } from "../test-support.ts";
import { FolderConfig, FolderConfigs, effectiveSettings, folderChain, parseFolderConfig } from "./folder-config.ts";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

const config = (entries: Record<string, string>, warn?: (message: string) => void) =>
  new FolderConfig(new Map(Object.entries(entries).map(([folder, text]) => [folder, parseFolderConfig(text, folder)])), warn);

describe("parsing", () => {
  test("reads the two keys and ignores invalid values and other keys", () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    expect(parseFolderConfig("folderType: CHANGE\ndefaultPrefix: WORK\nother: 1\n", "f", warn)).toEqual({ folderType: "CHANGE", defaultPrefix: "WORK" });
    expect(parseFolderConfig("folderType: SOMETIMES\ndefaultPrefix: work\n", "f", warn)).toEqual({});
    expect(parseFolderConfig("folderType: [\n", "f", warn)).toEqual({});
    expect(parseFolderConfig("- a\n", "f", warn)).toEqual({});
    expect(parseFolderConfig("", "f", warn)).toEqual({});
    expect(warnings.length).toBe(4);
  });
});

describe("inheritance", () => {
  test("each key comes from the nearest folder that sets it", () => {
    const c = config({ docs: "folderType: BASELINE\ndefaultPrefix: REQ\n", "docs/specs": "defaultPrefix: SPEC\n", "docs/old": "folderType: NONSECTIONED\n" });
    expect(c.prefixFor("docs/a.md")).toBe("REQ");
    expect(c.prefixFor("docs/specs/deep/a.md")).toBe("SPEC");
    expect(c.isSectioned("docs/old/a.md")).toBe(false);
    expect(c.isSectioned("a.md")).toBe(false);
    expect(c.isSectioned("docs/a.txt")).toBe(false);
    expect(c.effective("docs/specs/deep")).toEqual({ folderType: { value: "BASELINE", from: "docs" }, defaultPrefix: { value: "SPEC", from: "docs/specs" } });
    expect(c.prefixes()).toEqual(new Set(["REQ", "SPEC"]));
  });

  test("a sectioned type without a prefix isn't sectioned, with one warning", () => {
    const warnings: string[] = [];
    const c = config({ "": "folderType: AUXILIARY\n" }, (message) => warnings.push(message));
    expect(c.isSectioned("a.md")).toBe(false);
    expect(c.isSectioned("b/a.md")).toBe(false);
    expect(warnings).toEqual([".specquer-config.yaml: a AUXILIARY folder needs a defaultPrefix; its files aren't sectioned"]);
  });

  test("the chain runs up to the root folder", () => {
    expect(folderChain("a/b")).toEqual(["a/b", "a", ""]);
    expect(folderChain("")).toEqual([""]);
    expect(effectiveSettings("a", () => undefined).folderType).toEqual({ value: null, from: null });
  });
});

describe("reading the files", () => {
  test("finds the files the tree listing visits and reads each again only when it changes", async () => {
    const temp = await tempRoot({
      ".specquer-config.yaml": "folderType: BASELINE\ndefaultPrefix: TOP\n",
      "docs/.specquer-config.yaml": "defaultPrefix: REQ\n",
      "docs/a.md": "",
      "node_modules/x/.specquer-config.yaml": "folderType: NONSECTIONED\n",
    });
    cleanups.push(temp.cleanup);
    const files = new FileService(temp.root);
    const listed = await files.listFiles();
    expect(listed.configs).toEqual([".specquer-config.yaml", "docs/.specquer-config.yaml"]);
    const path = join(temp.root, "docs/.specquer-config.yaml");
    await utimes(path, 1000, 1000);
    const configs = new FolderConfigs(temp.root, async () => (await files.listFiles()).configs, () => {});
    expect((await configs.load()).prefixFor("docs/a.md")).toBe("REQ");
    // An unchanged modification time isn't read again
    await Bun.write(path, "defaultPrefix: NEW\n");
    await utimes(path, 1000, 1000);
    expect((await configs.load()).prefixFor("docs/a.md")).toBe("REQ");
    configs.invalidate();
    expect((await configs.load()).prefixFor("docs/a.md")).toBe("NEW");
    // A file deleted: its folder inherits
    await Bun.file(path).delete();
    configs.setFiles((await files.listFiles()).configs);
    expect((await configs.load()).prefixFor("docs/a.md")).toBe("TOP");
  });

  test("Git's listing includes untracked files and leaves out ignored ones", async () => {
    const temp = await tempRoot({ ".gitignore": "ignored/\n", "a/.specquer-config.yaml": "", "ignored/.specquer-config.yaml": "" }, { git: true });
    cleanups.push(temp.cleanup);
    await Bun.write(join(temp.root, "b/.specquer-config.yaml"), "");
    expect((await new FileService(temp.root).listFiles()).configs).toEqual(["a/.specquer-config.yaml", "b/.specquer-config.yaml"]);
  });

  test("a folder holding only its configuration file shows in the tree", async () => {
    const temp = await tempRoot({ "new/.specquer-config.yaml": "folderType: CHANGE\n" });
    cleanups.push(temp.cleanup);
    const tree = await new FileService(temp.root).getTree();
    expect(tree.specs.root.children.map((child) => child.path)).toEqual(["new"]);
  });
});
