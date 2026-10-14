import { expect, test } from "bun:test";
import type { ThreadView } from "@specquer/shared/comments";
import { groupThreads, threadOrder } from "./comment-groups";

const BODY = [
  '<a id="REQ-00001" data-uid="rootrootroot"></a>',
  "",
  '<a id="REQ-00002" data-uid="titletitleti"></a>',
  "# Title",
  "",
  '<a id="REQ-00003" data-uid="subsubsubsub"></a>',
  "## Sub",
  "",
].join("\n");

const thread = (threadUid: string, sectionUid: string, status: "Open" | "Resolved" = "Open"): ThreadView => ({
  threadUid,
  sectionUid,
  status,
  comments: [{ commentUid: `c${threadUid}`, createdBy: "Ann", createdAt: "2026-10-10T12:00:00Z", text: "Hi.", version: "v" }],
});

test("threads are grouped by section in document order, filtered, with detached ones apart", () => {
  const threads = [thread("t1", "subsubsubsub"), thread("t2", "titletitleti", "Resolved"), thread("t3", "titletitleti"), thread("t4", "gonegonegone")];
  const open = groupThreads(BODY, threads, "open");
  expect(open.groups.map((g) => [g.sectionId, g.title, g.threads.map((t) => t.threadUid)])).toEqual([
    ["REQ-00002", "Title", ["t3"]],
    ["REQ-00003", "Sub", ["t1"]],
  ]);
  expect(open.detached.map((t) => t.threadUid)).toEqual(["t4"]);
  expect(open.hidden).toBe(1);
  expect(threadOrder(open).map((t) => t.threadUid)).toEqual(["t3", "t1", "t4"]);
  expect(groupThreads(BODY, threads, "resolved").groups.map((g) => g.sectionId)).toEqual(["REQ-00002"]);
  expect(groupThreads(BODY, threads, "all").groups[0]!.threads.map((t) => t.threadUid)).toEqual(["t2", "t3"]);
});

test("a section being given its first thread has a group, and the root section is the document", () => {
  const groups = groupThreads(BODY, [], "open", undefined, "rootrootroot");
  expect(groups.groups).toEqual([{ sectionUid: "rootrootroot", sectionId: "REQ-00001", title: "Document", threads: [] }]);
});

test("a section deleted in the editor detaches its threads at once", () => {
  const edited = BODY.split('<a id="REQ-00003"')[0]!;
  expect(groupThreads(edited, [thread("t1", "subsubsubsub")], "open").detached.map((t) => t.threadUid)).toEqual(["t1"]);
});
