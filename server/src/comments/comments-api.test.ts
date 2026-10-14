import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";
import type { SectionProblem } from "@specquer/shared/api";
import type { CommentChange, CommentChangeResult, CommentsResponse } from "@specquer/shared/comments";
import { gitUserName } from "../git.ts";
import { tempRoot, testApp } from "../test-support.ts";
import { parseSidecar, serializeSidecar } from "./sidecar.ts";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

const DOC = [
  '<a id="REQ-00001" data-uid="rootrootroot"></a>',
  "",
  '<a id="REQ-00002" data-uid="titletitleti"></a>',
  "# Title",
  "",
  '<a id="REQ-00003" data-uid="subsubsubsub"></a>',
  "## Sub",
  "",
].join("\n");

async function setup(files: Record<string, string> = {}, options: { git?: boolean } = {}) {
  const temp = await tempRoot({ "docs/.specquer-config.yaml": "folderType: BASELINE\ndefaultPrefix: REQ\n", "docs/a.md": DOC, "notes/n.md": "# N\n", ...files }, options);
  cleanups.push(temp.cleanup);
  let clock = Date.parse("2026-10-14T10:00:00Z");
  const app = testApp(temp.root, undefined, undefined, undefined, {
    userName: async () => "Ann",
    now: () => new Date((clock += 1000)),
  });
  const read = (path: string) => Bun.file(join(temp.root, path)).text();
  const exists = (path: string) => Bun.file(join(temp.root, path)).exists();
  const write = (path: string, text: string) => Bun.write(join(temp.root, path), text);
  const threads = async (path = "docs/a.md") => (await (await app.request(`/api/comments?path=${encodeURIComponent(path)}`)).json()) as CommentsResponse;
  const change = async (change: CommentChange, path = "docs/a.md") =>
    (await (await app.request(`/api/comments?path=${encodeURIComponent(path)}`, { method: "PATCH", body: change })).json()) as CommentChangeResult;
  const problems = async (folder = "") =>
    ((await (await app.request(`/api/sections/problems?folder=${encodeURIComponent(folder)}`)).json()) as { problems: SectionProblem[] }).problems;
  return { root: temp.root, ...app, read, exists, write, threads, change, problems };
}

/** Adds a thread and returns its UIDs. */
async function addThread(s: Awaited<ReturnType<typeof setup>>, text = "First.", sectionUid = "subsubsubsub") {
  const result = await s.change({ op: "add-thread", sectionUid, text });
  if (!result.ok || result.created === undefined) throw new Error(`not added: ${JSON.stringify(result)}`);
  return result.created;
}

describe("comment threads", () => {
  test("a thread is added, replied to, edited and resolved, and the sidecar holds it", async () => {
    const s = await setup();
    expect(await s.threads()).toEqual({ available: true, threads: [] });
    expect(await s.exists("docs/a.md.comments.yaml")).toBe(false);
    const { threadUid } = await addThread(s, "First.\nSecond line.");
    const reply = await s.change({ op: "reply", threadUid, text: "A reply." });
    expect(reply.ok).toBe(true);
    const replyUid = reply.ok ? reply.created!.commentUid : "";
    const version = (await s.threads()).threads[0]!.comments[1]!.version;
    expect((await s.change({ op: "edit", threadUid, commentUid: replyUid, text: "Edited.", baseVersion: version })).ok).toBe(true);
    expect((await s.change({ op: "set-status", threadUid, status: "Resolved" })).ok).toBe(true);

    const [thread] = (await s.threads()).threads;
    expect(thread).toMatchObject({ sectionUid: "subsubsubsub", status: "Resolved", statusChangedBy: "Ann", statusChangedAt: "2026-10-14T10:00:04Z" });
    expect(thread!.comments.map((c) => [c.text, c.createdBy, c.createdAt, c.updatedBy, c.updatedAt])).toEqual([
      ["First.\nSecond line.", "Ann", "2026-10-14T10:00:01Z", undefined, undefined],
      ["Edited.", "Ann", "2026-10-14T10:00:02Z", "Ann", "2026-10-14T10:00:03Z"],
    ]);
    const text = await s.read("docs/a.md.comments.yaml");
    expect(text).toStartWith("# Comment threads");
    expect(text).toContain("        text: |-\n          First.\n          Second line.\n");
    // Times quoted, as YAML 1.1 readers would take them for dates otherwise
    expect(text).toContain("createdAt: '2026-10-14T10:00:01Z'");
    expect(text.indexOf("threadUid")).toBeLessThan(text.indexOf("sectionUid"));
  });

  test("a resolved thread is read-only until reopened, but can be deleted", async () => {
    const s = await setup();
    const { threadUid, commentUid } = await addThread(s);
    await s.change({ op: "set-status", threadUid, status: "Resolved" });
    expect(await s.change({ op: "reply", threadUid, text: "More." })).toMatchObject({ ok: false, reason: "resolved" });
    expect(await s.change({ op: "delete-comment", threadUid, commentUid })).toMatchObject({ ok: false, reason: "resolved" });
    expect((await s.change({ op: "set-status", threadUid, status: "Open" })).ok).toBe(true);
    expect((await s.change({ op: "reply", threadUid, text: "More." })).ok).toBe(true);
    await s.change({ op: "set-status", threadUid, status: "Resolved" });
    expect((await s.change({ op: "delete-thread", threadUid })).ok).toBe(true);
    // The last thread takes the sidecar with it
    expect(await s.exists("docs/a.md.comments.yaml")).toBe(false);
  });

  test("deleting: a reply alone, a first comment only without replies", async () => {
    const s = await setup();
    const { threadUid, commentUid } = await addThread(s);
    const reply = await s.change({ op: "reply", threadUid, text: "A reply." });
    expect(await s.change({ op: "delete-comment", threadUid, commentUid })).toMatchObject({ ok: false, reason: "has-replies" });
    expect((await s.change({ op: "delete-comment", threadUid, commentUid: reply.ok ? reply.created!.commentUid : "" })).ok).toBe(true);
    expect((await s.change({ op: "delete-comment", threadUid, commentUid })).ok).toBe(true);
    expect((await s.threads()).threads).toEqual([]);
  });

  test("refuses empty text, unknown sections and files that can't have threads", async () => {
    const s = await setup();
    expect(await s.change({ op: "add-thread", sectionUid: "subsubsubsub", text: "  \n" })).toMatchObject({ ok: false, reason: "empty" });
    expect(await s.change({ op: "add-thread", sectionUid: "nosuchsectio", text: "Hi." })).toMatchObject({ ok: false, reason: "not-found" });
    expect(await s.threads("notes/n.md")).toEqual({ available: false, threads: [] });
    expect(await s.change({ op: "add-thread", sectionUid: "subsubsubsub", text: "Hi." }, "notes/n.md")).toMatchObject({ ok: false, reason: "unavailable" });
  });

  test("a change keeps what changed on disk meanwhile, and an edit to a changed comment is refused", async () => {
    const s = await setup();
    const { threadUid, commentUid } = await addThread(s);
    const version = (await s.threads()).threads[0]!.comments[0]!.version;
    // Someone else's thread arrives with a Git pull
    const parsed = parseSidecar(await s.read("docs/a.md.comments.yaml"));
    if (!parsed.ok) throw new Error(parsed.message);
    const theirs = { threadUid: "theirthreadx", sectionUid: "titletitleti", status: "Open" as const, comments: [{ commentUid: "theircomment", createdBy: "Bo", createdAt: "2026-10-01T00:00:00Z", text: "Theirs." }] };
    await s.write("docs/a.md.comments.yaml", serializeSidecar([...parsed.threads, theirs]));
    expect((await s.change({ op: "reply", threadUid, text: "Mine." })).ok).toBe(true);
    expect((await s.threads()).threads.map((t) => t.threadUid)).toEqual([threadUid, "theirthreadx"]);
    // The comment itself changed on disk: the edit is refused, and what is on disk comes back
    const changed = parseSidecar(await s.read("docs/a.md.comments.yaml"));
    if (!changed.ok) throw new Error(changed.message);
    changed.threads[0]!.comments[0]!.text = "Changed elsewhere.";
    await s.write("docs/a.md.comments.yaml", serializeSidecar(changed.threads));
    const refused = await s.change({ op: "edit", threadUid, commentUid, text: "Mine.", baseVersion: version });
    expect(refused).toMatchObject({ ok: false, reason: "conflict" });
    expect(refused.threads[0]!.comments[0]!.text).toBe("Changed elsewhere.");
  });

  test("an edit that changes nothing writes nothing", async () => {
    const s = await setup();
    const { threadUid, commentUid } = await addThread(s);
    const before = await s.read("docs/a.md.comments.yaml");
    const version = (await s.threads()).threads[0]!.comments[0]!.version;
    expect((await s.change({ op: "edit", threadUid, commentUid, text: "First.", baseVersion: version })).ok).toBe(true);
    expect(await s.read("docs/a.md.comments.yaml")).toBe(before);
  });
});

describe("the sidecar with its document", () => {
  test("follows a rename and goes with a delete, which lists it", async () => {
    const s = await setup();
    await addThread(s);
    await s.request("/api/rename", { method: "POST", body: { path: "docs/a.md", newName: "b.md" } });
    expect(await s.exists("docs/a.md.comments.yaml")).toBe(false);
    expect((await s.threads("docs/b.md")).threads).toHaveLength(1);
    const preview = (await (await s.request("/api/entry/delete-preview?path=docs%2Fb.md")).json()) as { files: string[]; fileCount: number };
    expect(preview).toMatchObject({ files: ["docs/b.md", "docs/b.md.comments.yaml"], fileCount: 2 });
    await s.request("/api/entry?path=docs%2Fb.md", { method: "DELETE" });
    expect(await s.exists("docs/b.md.comments.yaml")).toBe(false);
  });

  test("a leftover sidecar is deleted when a document is created or renamed onto its name", async () => {
    const s = await setup({ "docs/new.md.comments.yaml": "threads: []\n", "docs/c.md.comments.yaml": "threads: []\n" });
    await s.request("/api/create", { method: "POST", body: { parent: "docs", name: "new.md", kind: "file" } });
    expect(await s.exists("docs/new.md.comments.yaml")).toBe(false);
    await s.request("/api/rename", { method: "POST", body: { path: "docs/a.md", newName: "c.md" } });
    expect(await s.exists("docs/c.md.comments.yaml")).toBe(false);
  });
});

describe("problems", () => {
  test("unusable and orphaned sidecars, and detached threads", async () => {
    const s = await setup({ "docs/gone.md.comments.yaml": "threads: []\n", "docs/b.md": DOC.replace(/REQ-0000(\d)/g, "REQ-0001$1").replace(/data-uid="([a-z]+)"/g, 'data-uid="x$1"'), "docs/b.md.comments.yaml": "threads: [\n" });
    const { threadUid } = await addThread(s);
    // The section goes
    const file = (await (await s.request("/api/file?path=docs%2Fa.md")).json()) as { version: string };
    await s.request("/api/file?path=docs%2Fa.md", { method: "PUT", body: { text: DOC.split("<a id=\"REQ-00003\"")[0], baseVersion: file.version } });
    const problems = await s.problems("docs");
    expect(problems).toContainEqual({ kind: "orphaned-sidecar", path: "docs/gone.md.comments.yaml" });
    expect(problems).toContainEqual(expect.objectContaining({ kind: "comment-sidecar", path: "docs/b.md.comments.yaml", problem: "unparsable" }));
    expect(problems).toContainEqual({ kind: "detached-thread", path: "docs/a.md", threadUid, sectionUid: "subsubsubsub", text: "First." });
    expect(await s.problems("notes")).toEqual([]);
    // An unusable sidecar isn't written
    expect(await s.change({ op: "add-thread", sectionUid: "xsubsubsubsub", text: "Hi." }, "docs/b.md")).toMatchObject({ ok: false, reason: "unusable" });
    expect(await s.read("docs/b.md.comments.yaml")).toBe("threads: [\n");
  });

  test("each kind of unusable sidecar", () => {
    const thread = (extra: string) => `threads:\n  - threadUid: aaaaaaaaaaaa\n    sectionUid: bbbbbbbbbbbb\n    status: ${extra}\n    comments:\n      - commentUid: aaaaaaaaaaaa\n        createdBy: A\n        createdAt: '2026-10-10T12:22:59Z'\n        text: x\n`;
    expect(parseSidecar("<<<<<<< HEAD\nthreads: []\n=======\n>>>>>>> other\n")).toMatchObject({ ok: false, problem: "conflict-markers" });
    expect(parseSidecar("threads: [")).toMatchObject({ ok: false, problem: "unparsable" });
    expect(parseSidecar("threads: 3")).toMatchObject({ ok: false, problem: "format" });
    expect(parseSidecar(thread("Closed"))).toMatchObject({ ok: false, problem: "unknown-status" });
    expect(parseSidecar(thread("Open"))).toMatchObject({ ok: false, problem: "repeated-uid" });
    expect(parseSidecar("")).toEqual({ ok: true, threads: [] });
  });

  test("Git lists sidecars, and so does the walk", async () => {
    for (const git of [true, false]) {
      const s = await setup({ "docs/a.md.comments.yaml": "threads: []\n", "docs/x.md.comments.yaml": "threads: []\n" }, { git });
      expect(await s.problems("docs")).toEqual([{ kind: "orphaned-sidecar", path: "docs/x.md.comments.yaml" }]);
    }
  });
});

test("the user's name comes from Git, else the login name", async () => {
  const temp = await tempRoot({}, { git: true });
  cleanups.push(temp.cleanup);
  await $`git -C ${temp.root} config user.name "Martha Test"`.quiet();
  expect(await gitUserName(temp.root)).toBe("Martha Test");
  // An empty name (this repository's, over any global one) falls back to the email
  await $`git -C ${temp.root} config user.name ""`.quiet();
  await $`git -C ${temp.root} config user.email m@example.com`.quiet();
  expect(await gitUserName(temp.root)).toBe("m@example.com");
  const plain = await tempRoot();
  cleanups.push(plain.cleanup);
  // Outside a repository, the global configuration or the login name
  expect((await gitUserName(plain.root)).length).toBeGreaterThan(0);
});
