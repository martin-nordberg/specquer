import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findSections } from "@specquer/shared/markdown";
import { tempRoot, testApp } from "../test-support.ts";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

const CONFIG = 'prefixes:\n  "docs/": REQ\n  "docs/specs/": SPEC\n';

async function setup(files: Record<string, string>, options: { git?: boolean; config?: string | null } = {}) {
  const config = options.config === undefined ? CONFIG : options.config;
  const temp = await tempRoot({ ...files, ...(config === null ? {} : { ".specquer/shared/section-prefixes.config.yaml": config }) }, options);
  cleanups.push(temp.cleanup);
  const app = testApp(temp.root);
  // Bun.file().text() drops a byte-order mark
  const read = async (path: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(await Bun.file(join(temp.root, path)).bytes());
  const exists = (path: string) => Bun.file(join(temp.root, path)).exists();
  const write = (path: string, text: string) => Bun.write(join(temp.root, path), text);
  /** Reads a file and saves new text over it. */
  const save = async (path: string, text: string) => {
    const file = (await (await app.request(`/api/file?path=${encodeURIComponent(path)}`)).json()) as { version: string };
    const res = await app.request(`/api/file?path=${encodeURIComponent(path)}`, { method: "PUT", body: { text, baseVersion: file.version } });
    return (await res.json()) as { version: string; edits?: Array<{ from: number; to: number; insert: string }> };
  };
  return { root: temp.root, ...app, read, exists, write, save };
}

const ids = (text: string) => findSections(text.replace(/^---\n[\s\S]*?\n---\n/, "")).map((s) => s.id);

describe("saving", () => {
  test("adds anchors to a sectioned file and returns the edits", async () => {
    const { save, read } = await setup({ "docs/a.md": "# Title\n\nText\n\n## Sub\n" });
    const result = await save("docs/a.md", "# Title\n\nText\n\n## Sub\n");
    const text = await read("docs/a.md");
    expect(ids(text)).toEqual(["REQ-00001", "REQ-00002", "REQ-00003"]);
    expect(result.edits?.length).toBe(3);
    expect(text).toMatch(/^<a id="REQ-00001" data-document-id="[a-z0-9]+"><\/a>\n\n<a id="REQ-00002"><\/a>\n# Title/);
    // Saving again changes nothing
    const again = await save("docs/a.md", text);
    expect(again.edits).toBeUndefined();
    expect(await read("docs/a.md")).toBe(text);
  });

  test("keeps front matter, CRLF line endings and the byte-order mark", async () => {
    const { save, read } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "﻿---\r\ntitle: A\r\n---\r\n# Title\r\n");
    const text = await read("docs/a.md");
    expect(text.startsWith("﻿---\r\ntitle: A\r\n---\r\n<a id=\"REQ-00001\"")).toBe(true);
    expect(text).toContain('<a id="REQ-00002"></a>\r\n# Title\r\n');
    expect(text.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  test("files that aren't sectioned are saved as sent", async () => {
    const { save, read } = await setup({ "other/a.md": "", "docs/x.md": "" });
    expect((await save("other/a.md", "# Title\n")).edits).toBeUndefined();
    expect(await read("other/a.md")).toBe("# Title\n");
  });

  test("without a configuration nothing is sectioned and no data file is written", async () => {
    const { save, read, exists } = await setup({ "docs/a.md": "" }, { config: null });
    await save("docs/a.md", "# Title\n");
    expect(await read("docs/a.md")).toBe("# Title\n");
    expect(await exists(".specquer/shared/documents.yaml")).toBe(false);
  });

  test("records documents and sections in the data files", async () => {
    const { save, read } = await setup({ "docs/specs/s.md": "" });
    await save("docs/specs/s.md", "# Spec\n");
    const documents = await read(".specquer/shared/documents.yaml");
    const sections = await read(".specquer/shared/SPEC/sections.yaml");
    expect(documents).toMatch(/^ {2}[a-z0-9]+: \{ path: docs\/specs\/s\.md \}$/m);
    expect(sections).toContain("lastSequence: 2\n");
    expect(sections).toMatch(/^ {2}[a-z0-9]+: \{ id: SPEC-00002, documentId: [a-z0-9]+ \}$/m);
  });

  test("placeholders get IDs, a typed ID is kept, a taken or unknown one renumbered", async () => {
    const { save, read } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "# A\n");
    const first = await read("docs/a.md");
    const typed = `${first}\n<a id="REQ-00040"></a>\n## Typed\n\n<a id="REQ-00002"></a>\n## Taken\n\n<a id="XYZ-00001"></a>\n## Unknown\n\n* <a id=""></a> one\n* two\n`;
    await save("docs/a.md", typed);
    expect(ids(await read("docs/a.md"))).toEqual(["REQ-00001", "REQ-00002", "REQ-00040", "REQ-00041", "REQ-00042", "REQ-00043", "REQ-00044"]);
  });

  test("numbers are never reused after a section is deleted", async () => {
    const { save, read } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "# A\n\n# B\n");
    const text = await read("docs/a.md");
    const withoutB = text.replace(/<a id="REQ-00003"><\/a>\n# B\n/, "");
    await save("docs/a.md", withoutB);
    await save("docs/a.md", `${await read("docs/a.md")}\n# C\n`);
    expect(ids(await read("docs/a.md"))).toEqual(["REQ-00001", "REQ-00002", "REQ-00004"]);
  });

  test("a copy of a file gets new IDs when it is saved", async () => {
    const { save, read, write, request } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "# A\n");
    const original = await read("docs/a.md");
    await write("docs/copy.md", original);
    await request("/api/tree");
    await save("docs/copy.md", original);
    const copy = await read("docs/copy.md");
    expect(ids(copy)).toEqual(["REQ-00003", "REQ-00004"]);
    const documentId = (text: string) => /data-document-id="([a-z0-9]+)"/.exec(text)?.[1];
    expect(documentId(copy)).not.toBe(documentId(original));
    expect(await read("docs/a.md")).toBe(original);
  });

  test("a file moved outside Specquer keeps its IDs and its path is updated", async () => {
    const { root, save, read, request } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "# A\n");
    const original = await read("docs/a.md");
    await Bun.$`mv ${join(root, "docs/a.md")} ${join(root, "docs/b.md")}`.quiet();
    await request("/api/tree");
    await save("docs/b.md", original);
    expect(await read("docs/b.md")).toBe(original);
    const documents = await read(".specquer/shared/documents.yaml");
    expect(documents).toContain("path: docs/b.md");
    expect(documents).not.toContain("path: docs/a.md");
  });
});

describe("scanning writes nothing", () => {
  test("a tree load indexes files without writing", async () => {
    const { request, sections, exists, read } = await setup({ "docs/a.md": "# A\n" });
    await request("/api/tree");
    await sections.scan();
    expect(await exists(".specquer/shared/documents.yaml")).toBe(false);
    expect(await read("docs/a.md")).toBe("# A\n");
  });
});

describe("create, rename, delete", () => {
  test("a new sectioned file starts with its root anchor", async () => {
    const { request, read } = await setup({ "docs/x.md": "", "other/y.md": "" });
    await request("/api/create", { method: "POST", body: { parent: "docs", name: "new.md", kind: "file" } });
    expect(ids(await read("docs/new.md"))).toEqual(["REQ-00001"]);
    await request("/api/create", { method: "POST", body: { parent: "other", name: "new.md", kind: "file" } });
    expect(await read("other/new.md")).toBe("");
  });

  test("renaming a folder updates the paths; moving out of the configuration drops the document", async () => {
    const { request, save, read } = await setup({ "docs/sub/a.md": "" });
    await save("docs/sub/a.md", "# A\n");
    await request("/api/rename", { method: "POST", body: { path: "docs/sub", newName: "renamed" } });
    expect(await read(".specquer/shared/documents.yaml")).toContain("path: docs/renamed/a.md");
    await request("/api/rename", { method: "POST", body: { path: "docs", newName: "elsewhere" } });
    const documents = await read(".specquer/shared/documents.yaml");
    expect(documents).not.toContain("path:");
    expect(await read(".specquer/shared/REQ/sections.yaml")).toContain("lastSequence: 2\n");
  });

  test("deleting a folder drops its documents and sections", async () => {
    const { request, save, read } = await setup({ "docs/sub/a.md": "", "docs/b.md": "" });
    await save("docs/sub/a.md", "# A\n");
    await save("docs/b.md", "# B\n");
    await request("/api/entry?path=docs%2Fsub", { method: "DELETE" });
    const documents = await read(".specquer/shared/documents.yaml");
    expect(documents).toContain("path: docs/b.md");
    expect(documents).not.toContain("docs/sub/a.md");
    const sections = await read(".specquer/shared/REQ/sections.yaml");
    expect(sections).not.toContain("REQ-00001");
    expect(sections).toContain("REQ-00003");
  });
});

describe("section queries and Add section anchors", () => {
  test("lists a document's sections and searches across documents", async () => {
    const { request, save } = await setup({ "docs/a.md": "", "docs/b.md": "" });
    await save("docs/a.md", "# Alpha\n\n* <a id=\"\"></a> first item\n");
    await save("docs/b.md", "# Beta\n");
    const list = (await (await request("/api/sections?path=docs%2Fa.md")).json()) as { sections: Array<Record<string, unknown>> };
    expect(list.sections.map((s) => [s.id, s.kind, s.title])).toEqual([
      ["REQ-00001", "root", "a.md"],
      ["REQ-00002", "heading", "Alpha"],
      ["REQ-00003", "item", "first item"],
    ]);
    expect(list.sections.every((s) => typeof s.uid === "string")).toBe(true);
    const search = (await (await request("/api/sections/search?q=bet")).json()) as { results: Array<{ id: string; path: string }> };
    expect(search.results.map((r) => [r.id, r.path])).toEqual([["REQ-00005", "docs/b.md"]]);
    const byId = (await (await request("/api/sections/search?q=REQ-0000&path=docs%2Fb.md")).json()) as { results: unknown[] };
    expect(byId.results).toHaveLength(2);
  });

  test("dry run lists the files that would change; the run changes them", async () => {
    const { request, read, exists } = await setup({ "docs/a.md": "# A\n", "docs/specs/s.md": "# S\n", "other/c.md": "# C\n" });
    const dry = await request("/api/sections/anchor", { method: "POST", body: { folder: "", dryRun: true } });
    expect(((await dry.json()) as { files: string[] }).files).toEqual(["docs/a.md", "docs/specs/s.md"]);
    expect(await read("docs/a.md")).toBe("# A\n");
    expect(await exists(".specquer/shared/documents.yaml")).toBe(false);
    const run = await request("/api/sections/anchor", { method: "POST", body: { folder: "docs", dryRun: false } });
    expect(((await run.json()) as { files: string[] }).files).toEqual(["docs/a.md", "docs/specs/s.md"]);
    expect(ids(await read("docs/specs/s.md"))).toEqual(["SPEC-00001", "SPEC-00002"]);
    expect(await read("other/c.md")).toBe("# C\n");
    const again = await request("/api/sections/anchor", { method: "POST", body: { folder: "docs", dryRun: true } });
    expect(((await again.json()) as { files: string[] }).files).toEqual([]);
  });
});
