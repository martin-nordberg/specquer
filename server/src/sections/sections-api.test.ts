import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SectionInfo, SectionNotice, SectionProblem } from "@specquer/shared/api";
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
    return (await res.json()) as { version: string; edits?: Array<{ from: number; to: number; insert: string }>; notices?: SectionNotice[] };
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
    expect(text).toMatch(/^<a id="REQ-00001" data-uid="[a-z0-9]{12}"><\/a>\n\n<a id="REQ-00002" data-uid="[a-z0-9]{12}"><\/a>\n# Title/);
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
    expect(text).toMatch(/<a id="REQ-00002" data-uid="[a-z0-9]+"><\/a>\r\n# Title\r\n/);
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
    const withoutB = text.replace(/<a id="REQ-00003"[^>]*><\/a>\n# B\n/, "");
    expect(withoutB).not.toBe(text);
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
    const documentId = (text: string) => /^<a id="[^"]+" data-uid="([a-z0-9]+)"/.exec(text)?.[1];
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
    expect(sections).not.toMatch(/id: REQ-00001, documentId/);
    expect(sections).toMatch(/retired:\n(.*\n)*.*id: REQ-00001 \}/);
    expect(sections).toMatch(/id: REQ-00003, documentId/);
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

/** The anchor of the section with an ID, from a file's text. */
const anchorOf = (text: string, id: string) => new RegExp(`<a id="${id}" data-uid="([a-z0-9]+)"></a>`).exec(text);

describe("UIDs and conflicts", () => {
  test("every anchor gets a 12-character UID; the root's is the document ID", async () => {
    const { save, read } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "# A\n\n* <a id=\"\"></a> item\n");
    const text = await read("docs/a.md");
    const sections = findSections(text);
    expect(sections.map((s) => s.uid?.length)).toEqual([12, 12, 12]);
    const documents = await read(".specquer/shared/documents.yaml");
    expect(documents).toContain(`${sections[0]!.uid}: { path: docs/a.md }`);
    expect(await read(".specquer/shared/REQ/sections.yaml")).toContain(`${sections[0]!.uid}: { id: REQ-00001, documentId: ${sections[0]!.uid} }`);
  });

  test("an ID added in another file outside Specquer is never issued again", async () => {
    const { save, read, write } = await setup({ "docs/a.md": "", "docs/b.md": "" });
    await save("docs/a.md", "# A\n");
    // An agent adds a section with the next number to another file; no tree load follows
    await write("docs/b.md", '<a id="REQ-00003"></a>\n# By an agent\n');
    await save("docs/a.md", `${await read("docs/a.md")}\n# More\n`);
    expect(ids(await read("docs/a.md"))).toEqual(["REQ-00001", "REQ-00002", "REQ-00004"]);
  });

  test("data files changed on disk while the server runs are read again", async () => {
    const { save, read, write } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "# A\n");
    const sections = await read(".specquer/shared/REQ/sections.yaml");
    // A pull brings a teammate's section in another file, a higher lastSequence and a retired number
    await write("docs/b.md", '<a id="REQ-00040" data-uid="teamdoc00001"></a>\n\n<a id="REQ-00041" data-uid="teamsec00001"></a>\n# Theirs\n');
    await write(".specquer/shared/documents.yaml", `${await read(".specquer/shared/documents.yaml")}  teamdoc00001: { path: docs/b.md }\n`);
    await write(
      ".specquer/shared/REQ/sections.yaml",
      `${sections.replace("lastSequence: 2", "lastSequence: 50")}  teamdoc00001: { id: REQ-00040, documentId: teamdoc00001 }\n  teamsec00001: { id: REQ-00041, documentId: teamdoc00001 }\nretired:\n  gone00000001: { id: REQ-00050 }\n`,
    );
    await save("docs/a.md", `${await read("docs/a.md")}\n# Mine\n`);
    expect(ids(await read("docs/a.md"))).toEqual(["REQ-00001", "REQ-00002", "REQ-00051"]);
    const after = await read(".specquer/shared/REQ/sections.yaml");
    expect(after).toContain("teamsec00001: { id: REQ-00041, documentId: teamdoc00001 }");
    expect(after).toContain("gone00000001: { id: REQ-00050 }");
  });

  test("an edited ID is put back, with a notice", async () => {
    const { save, read } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "# A\n");
    const text = await read("docs/a.md");
    const result = await save("docs/a.md", text.replace('id="REQ-00002"', 'id="REQ-00099"'));
    expect(await read("docs/a.md")).toBe(text);
    expect(result.notices).toEqual([{ kind: "restored", id: "REQ-00099", newId: "REQ-00002", title: "A" }]);
  });

  test("a copy within a document is renumbered with a new UID, with a notice", async () => {
    const { save, read } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "# A\n");
    const text = await read("docs/a.md");
    const heading = /<a id="REQ-00002"[^>]*><\/a>\n# A\n/.exec(text)![0];
    // Identical copies can't be told apart: the first keeps the ID (the editor turns pasted copies into placeholders)
    const result = await save("docs/a.md", text.replace(heading, `${heading}\n${heading.replace("# A", "# Copy")}`));
    const after = await read("docs/a.md");
    expect(ids(after)).toEqual(["REQ-00001", "REQ-00002", "REQ-00003"]);
    expect(anchorOf(after, "REQ-00003")![1]).not.toBe(anchorOf(after, "REQ-00002")![1]);
    expect(result.notices).toEqual([{ kind: "renumbered", reason: "copy", id: "REQ-00002", newId: "REQ-00003", title: "Copy" }]);
  });

  test("a copy in another document is reported until the user renumbers it", async () => {
    const { save, read, request } = await setup({ "docs/a.md": "", "docs/b.md": "" });
    await save("docs/a.md", "# A\n");
    await save("docs/b.md", "# B\n");
    const heading = /<a id="REQ-00002"[^>]*><\/a>\n# A\n/.exec(await read("docs/a.md"))![0];
    const result = await save("docs/b.md", `${await read("docs/b.md")}\n${heading}`);
    expect(result.notices).toBeUndefined();
    expect(ids(await read("docs/b.md"))).toEqual(["REQ-00003", "REQ-00004", "REQ-00002"]);

    const problems = (await (await request("/api/sections/problems")).json()) as { problems: SectionProblem[] };
    expect(problems.problems).toEqual([
      {
        kind: "duplicate",
        id: "REQ-00002",
        occurrences: [
          { path: "docs/a.md", uid: anchorOf(await read("docs/a.md"), "REQ-00002")![1]!, title: "A", keeps: true },
          { path: "docs/b.md", uid: anchorOf(await read("docs/a.md"), "REQ-00002")![1]!, title: "A", keeps: false },
        ],
      },
    ]);
    const listed = (await (await request("/api/sections?path=docs%2Fb.md")).json()) as { sections: SectionInfo[] };
    expect(listed.sections[2]!.problem).toEqual({ kind: "duplicate", keeps: false, others: [{ path: "docs/a.md", title: "A" }] });

    const file = (await (await request("/api/file?path=docs%2Fb.md")).json()) as { version: string };
    const uid = anchorOf(await read("docs/b.md"), "REQ-00002")![1]!;
    const renumbered = await request("/api/sections/renumber", { method: "POST", body: { path: "docs/b.md", id: "REQ-00002", uid, baseVersion: file.version } });
    const body = (await renumbered.json()) as { edits: unknown[]; notices: SectionNotice[] };
    expect(body.notices).toEqual([{ kind: "renumbered", reason: "duplicate", id: "REQ-00002", newId: "REQ-00005", title: "A" }]);
    expect(ids(await read("docs/b.md"))).toEqual(["REQ-00003", "REQ-00004", "REQ-00005"]);
    expect(anchorOf(await read("docs/b.md"), "REQ-00005")![1]).not.toBe(uid);
    expect(((await (await request("/api/sections/problems")).json()) as { problems: unknown[] }).problems).toEqual([]);
    // A stale version is refused
    const stale = await request("/api/sections/renumber", { method: "POST", body: { path: "docs/b.md", id: "REQ-00003", uid: null, baseVersion: file.version } });
    expect(stale.status).toBe(409);
  });

  test("two branches' sections with one number are reported as a collision", async () => {
    const { save, read, write, request } = await setup({ "docs/a.md": "", "docs/b.md": "" });
    await save("docs/a.md", "# A\n");
    await save("docs/b.md", "# B\n");
    // Each branch added REQ-00005 to its own document
    await write("docs/a.md", `${await read("docs/a.md")}\n<a id="REQ-00005" data-uid="branchone001"></a>\n# One\n`);
    await write("docs/b.md", `${await read("docs/b.md")}\n<a id="REQ-00005" data-uid="branchtwo001"></a>\n# Two\n`);
    const problems = (await (await request("/api/sections/problems?folder=docs")).json()) as { problems: SectionProblem[] };
    expect(problems.problems.map((p) => [p.kind, "id" in p ? p.id : ""])).toEqual([["collision", "REQ-00005"]]);
    // Saving either file leaves both alone
    expect((await save("docs/b.md", await read("docs/b.md"))).notices).toBeUndefined();
    expect(ids(await read("docs/b.md"))).toEqual(["REQ-00003", "REQ-00004", "REQ-00005"]);
  });

  test("a retired number typed again is renumbered; a restored section keeps its ID and UID", async () => {
    const { save, read } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "# A\n\n# B\n");
    const text = await read("docs/a.md");
    const b = /<a id="REQ-00003"[^>]*><\/a>\n# B\n/.exec(text)![0];
    await save("docs/a.md", text.replace(b, ""));
    expect(await read(".specquer/shared/REQ/sections.yaml")).toMatch(/retired:\n.*id: REQ-00003 \}/);
    // Restored, as by git restore: kept
    await save("docs/a.md", text);
    expect(await read("docs/a.md")).toBe(text);
    expect(await read(".specquer/shared/REQ/sections.yaml")).not.toContain("retired");
    // Deleted again, then the number typed by hand: renumbered
    await save("docs/a.md", text.replace(b, ""));
    const result = await save("docs/a.md", `${await read("docs/a.md")}\n<a id="REQ-00003"></a>\n# Typed\n`);
    expect(ids(await read("docs/a.md"))).toEqual(["REQ-00001", "REQ-00002", "REQ-00004"]);
    expect(result.notices).toEqual([{ kind: "renumbered", reason: "reused", id: "REQ-00003", newId: "REQ-00004", title: "Typed" }]);
  });

  test("a file with conflict markers is saved as sent and reported", async () => {
    const { save, read, request } = await setup({ "docs/a.md": "" });
    const text = "# A\n<<<<<<< HEAD\n# Ours\n=======\n# Theirs\n>>>>>>> other\n";
    const result = await save("docs/a.md", text);
    expect(await read("docs/a.md")).toBe(text);
    expect(result.notices).toEqual([{ kind: "not-anchored" }]);
    const problems = (await (await request("/api/sections/problems")).json()) as { problems: SectionProblem[] };
    expect(problems.problems).toEqual([{ kind: "conflict-markers", path: "docs/a.md" }]);
    const dry = await request("/api/sections/anchor", { method: "POST", body: { folder: "", dryRun: true } });
    expect(((await dry.json()) as { files: string[] }).files).toEqual([]);
  });

  test("stray anchors are reported", async () => {
    const { save, read, write, request } = await setup({ "docs/a.md": "" });
    await save("docs/a.md", "# A\n");
    await write("docs/a.md", (await read("docs/a.md")).replace("# A", "Inserted paragraph.\n\n# A"));
    const problems = (await (await request("/api/sections/problems")).json()) as { problems: SectionProblem[] };
    expect(problems.problems).toEqual([{ kind: "stray", path: "docs/a.md", id: "REQ-00002", line: 3 }]);
  });
});

describe("the agent guide", () => {
  test("is added to AGENTS.md only when asked, and only once", async () => {
    const { request, read, exists } = await setup({ "docs/a.md": "# A\n" });
    const dry = (await (await request("/api/sections/anchor", { method: "POST", body: { folder: "", dryRun: true, addAgentGuide: true } })).json()) as {
      agentGuide: boolean;
    };
    expect(dry.agentGuide).toBe(false);
    expect(await exists("AGENTS.md")).toBe(false);
    await request("/api/sections/anchor", { method: "POST", body: { folder: "", dryRun: false } });
    expect(await exists("AGENTS.md")).toBe(false);
    const run = (await (await request("/api/sections/anchor", { method: "POST", body: { folder: "", dryRun: false, addAgentGuide: true } })).json()) as {
      agentGuide: boolean;
    };
    expect(run.agentGuide).toBe(true);
    const text = await read("AGENTS.md");
    expect(text).toContain("## Section anchors");
    await request("/api/sections/anchor", { method: "POST", body: { folder: "", dryRun: false, addAgentGuide: true } });
    expect(await read("AGENTS.md")).toBe(text);
  });

  test("is appended to an existing AGENTS.md", async () => {
    const { request, read } = await setup({ "docs/a.md": "# A\n", "AGENTS.md": "# Agents\n\nBe careful.\n" });
    await request("/api/sections/anchor", { method: "POST", body: { folder: "docs", dryRun: false, addAgentGuide: true } });
    const text = await read("AGENTS.md");
    expect(text.startsWith("# Agents\n\nBe careful.\n\n<!-- specquer:section-anchors -->\n")).toBe(true);
  });
});
