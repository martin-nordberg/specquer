import { describe, expect, mock, test } from "bun:test";
import { type CommentChange, type CommentChangeResult, type StoredThread, threadView } from "@specquer/shared/comments";
import type { Api } from "@/lib/api";
import { CommentStore } from "./comment-store";

/** A fake server holding one document's threads. */
function fakeApi(initial: StoredThread[] = []) {
  let threads = structuredClone(initial);
  let n = 0;
  const uid = () => `uid${String(++n).padStart(9, "0")}`;
  const changeComments = mock(async (_path: string, change: CommentChange): Promise<CommentChangeResult> => {
    const views = () => threads.map(threadView);
    const thread = "threadUid" in change ? threads.find((t) => t.threadUid === change.threadUid) : undefined;
    switch (change.op) {
      case "add-thread": {
        const created = { threadUid: uid(), commentUid: uid() };
        threads.push({ ...created, sectionUid: change.sectionUid, status: "Open", comments: [{ commentUid: created.commentUid, createdBy: "Ann", createdAt: "2026-10-10T12:00:00Z", text: change.text }] });
        return { ok: true, threads: views(), created: { threadUid: created.threadUid, commentUid: created.commentUid } };
      }
      case "reply": {
        const commentUid = uid();
        thread!.comments.push({ commentUid, createdBy: "Ann", createdAt: "2026-10-10T12:00:00Z", text: change.text });
        return { ok: true, threads: views(), created: { threadUid: change.threadUid, commentUid } };
      }
      case "edit": {
        const comment = thread!.comments.find((c) => c.commentUid === change.commentUid)!;
        if (threadView(thread!).comments.find((c) => c.commentUid === change.commentUid)!.version !== change.baseVersion) {
          return { ok: false, reason: "conflict", threads: views(), message: "Changed on disk." };
        }
        comment.text = change.text;
        comment.updatedBy = "Ann";
        comment.updatedAt = "2026-10-11T12:00:00Z";
        return { ok: true, threads: views() };
      }
      default:
        return { ok: true, threads: views() };
    }
  });
  const api = {
    comments: async () => ({ available: true, threads: threads.map(threadView) }),
    changeComments,
  } as unknown as Pick<Api, "comments" | "changeComments">;
  /** Another program changes the sidecar. */
  const external = (update: (threads: StoredThread[]) => void) => update(threads);
  return { api, changeComments, external, all: () => threads };
}

async function opened(initial: StoredThread[] = []) {
  const fake = fakeApi(initial);
  const store = new CommentStore(fake.api);
  await store.open("docs/a.md");
  return { store, ...fake };
}

const existing: StoredThread = {
  threadUid: "threadaaaaaa",
  sectionUid: "subsubsubsub",
  status: "Open",
  comments: [{ commentUid: "commentaaaaa", createdBy: "Bo", createdAt: "2026-10-10T12:00:00Z", text: "Original." }],
};

describe("CommentStore", () => {
  test("a new thread is saved when its editor closes; an empty one isn't", async () => {
    const { store, changeComments, all } = await opened();
    store.startThread("subsubsubsub");
    await store.save("  ", true);
    expect(changeComments).not.toHaveBeenCalled();
    expect(store.get().editing).toBeNull();
    store.startThread("subsubsubsub");
    await store.save("New.", true);
    expect(all()).toHaveLength(1);
    expect(store.get().threads[0]!.comments[0]!.text).toBe("New.");
    expect(store.get().expanded.has(all()[0]!.threadUid)).toBe(true);
  });

  test("starting a thread collapses the section's other threads", async () => {
    const { store } = await opened([existing]);
    store.toggle("threadaaaaaa");
    store.startThread("subsubsubsub");
    expect(store.get().expanded.has("threadaaaaaa")).toBe(false);
    expect(store.get().editing).toEqual({ kind: "new-thread", sectionUid: "subsubsubsub" });
  });

  test("saving without closing (the window lost the focus) keeps the editor, which then edits what it created", async () => {
    const { store, all, changeComments } = await opened();
    store.startThread("subsubsubsub");
    // The element's blur and the window's both save, one after the other
    await Promise.all([store.save("Draft.", false), store.save("Draft.", false)]);
    expect(all()).toHaveLength(1);
    expect(store.get().editing).toMatchObject({ kind: "edit", threadUid: all()[0]!.threadUid });
    await store.save("Draft, finished.", true);
    expect(all()).toHaveLength(1);
    expect(all()[0]!.comments[0]!.text).toBe("Draft, finished.");
    expect(changeComments).toHaveBeenCalledTimes(2);
  });

  test("an edit writes only changed, non-empty text", async () => {
    const { store, changeComments } = await opened([existing]);
    store.startEdit("threadaaaaaa", "commentaaaaa");
    await store.save("Original.", true);
    store.startEdit("threadaaaaaa", "commentaaaaa");
    await store.save("", true);
    expect(changeComments).not.toHaveBeenCalled();
    store.startEdit("threadaaaaaa", "commentaaaaa");
    await store.save("Changed.", true);
    expect(changeComments).toHaveBeenCalledTimes(1);
    expect(store.get().threads[0]!.comments[0]!.text).toBe("Changed.");
  });

  test("an edit to a comment changed on disk is refused, and the notice says so", async () => {
    const { store, external } = await opened([existing]);
    external((threads) => {
      threads[0]!.comments[0]!.text = "Changed elsewhere.";
    });
    store.startEdit("threadaaaaaa", "commentaaaaa");
    await store.save("Mine.", false);
    expect(store.get().notice).toBe("Changed on disk.");
    expect(store.get().editing).toBeNull();
    expect(store.get().threads[0]!.comments[0]!.text).toBe("Changed elsewhere.");
  });

  test("Escape closes without saving; flush saves the open editor's draft", async () => {
    const { store, changeComments } = await opened([existing]);
    store.startReply("threadaaaaaa");
    store.cancelEdit();
    expect(store.get().editing).toBeNull();
    store.startReply("threadaaaaaa");
    store.setDraftSource(() => "Typed.");
    await store.flush({ keepalive: true });
    expect(changeComments).toHaveBeenCalledWith("docs/a.md", { op: "reply", threadUid: "threadaaaaaa", text: "Typed." }, { keepalive: true });
  });

  test("another file's threads replace the first's, and nothing is kept from it", async () => {
    const { store } = await opened([existing]);
    store.toggle("threadaaaaaa");
    store.startReply("threadaaaaaa");
    await store.open("docs/b.md");
    expect(store.get()).toMatchObject({ path: "docs/b.md", editing: null });
    expect(store.get().expanded.size).toBe(0);
  });
});
