import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import { useSyncExternalStore } from "react";
import { type CommentChange, type CommentChangeResult, type CommentFilter, type StoredThread, threadView } from "@specquer/shared/comments";
import { CommentStore } from "@/app/comment-store";
import type { Api } from "@/lib/api";

// Milkdown needs a real browser; a textarea stands in for the comment editor
mock.module("./CommentEditor", () => ({
  CommentEditor: ({ initial, label, onSave, onCancel }: { initial: string; label: string; onSave: (text: string, close: boolean) => void; onCancel: () => void }) => (
    <textarea
      aria-label={label}
      defaultValue={initial}
      onBlur={(event) => onSave(event.currentTarget.value, true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    />
  ),
}));
const { CommentsPane } = await import("./CommentsPane");

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

const thread = (threadUid: string, sectionUid: string, texts: string[], status: "Open" | "Resolved" = "Open"): StoredThread => ({
  threadUid,
  sectionUid,
  status,
  comments: texts.map((text, i) => ({ commentUid: `${threadUid.slice(0, 6)}cmt${i}00`, createdBy: i === 0 ? "Ann" : "Bo", createdAt: "2026-10-10T12:00:00Z", text })),
});

function setup(stored: StoredThread[], options: { filter?: CommentFilter; body?: string | null } = {}) {
  let threads = structuredClone(stored);
  const changeComments = mock(async (_path: string, change: CommentChange): Promise<CommentChangeResult> => {
    if (change.op === "set-status") threads = threads.map((t) => (t.threadUid === change.threadUid ? { ...t, status: change.status } : t));
    if (change.op === "delete-thread") threads = threads.filter((t) => t.threadUid !== change.threadUid);
    if (change.op === "add-thread") {
      threads.push(thread("newthreadxxx", change.sectionUid, [change.text]));
      return { ok: true, threads: threads.map(threadView), created: { threadUid: "newthreadxxx", commentUid: "newthrcmt000" } };
    }
    return { ok: true, threads: threads.map(threadView) };
  });
  const api = { comments: async () => ({ available: true, threads: threads.map(threadView) }), changeComments } as unknown as Api;
  const store = new CommentStore(api);
  const onGoToSection = mock((_uid: string) => {});
  const onFilterChange = mock((_filter: CommentFilter) => {});
  function Harness() {
    const state = useSyncExternalStore(store.subscribe, store.get);
    return (
      <CommentsPane
        state={state}
        store={store}
        body={options.body === undefined ? BODY : options.body}
        filter={options.filter ?? "open"}
        onFilterChange={onFilterChange}
        onGoToSection={onGoToSection}
      />
    );
  }
  render(<Harness />);
  void store.open("docs/a.md");
  return { store, changeComments, onGoToSection, onFilterChange };
}

describe("CommentsPane", () => {
  test("groups threads by section in document order, hides filtered ones and lists detached ones last", async () => {
    setup([
      thread("threadsubaaa", "subsubsubsub", ["On the subsection."]),
      thread("threadtitlea", "titletitleti", ["On the title.", "A reply."]),
      thread("threadresolv", "titletitleti", ["Done."], "Resolved"),
      thread("threadgoneaa", "gonegonegone", ["Lost."]),
    ]);
    const groups = await screen.findAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Threads on REQ-00002 Title", "Threads on REQ-00003 Sub", "Detached threads"]);
    expect(within(groups[0]!).getByRole("button", { name: /On the title\./ }).textContent).toContain("1 reply");
    expect(screen.getByText("1 thread hidden by the filter")).toBeDefined();
    expect(screen.queryByText("Done.")).toBeNull();
  });

  test("the filter is a radio group", async () => {
    const { onFilterChange } = setup([], { filter: "all" });
    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Resolved" }));
    expect(onFilterChange).toHaveBeenCalledWith("resolved");
    expect(await screen.findByText(/No comment threads yet/)).toBeDefined();
  });

  test("a group's header goes to its section; a new thread collapses the others and is saved on blur", async () => {
    const { onGoToSection, changeComments } = setup([thread("threadsubaaa", "subsubsubsub", ["First."])]);
    fireEvent.click(await screen.findByRole("button", { name: /^First\./ }));
    expect(screen.getByRole("button", { name: /^First\./ }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "REQ-00003 Sub" }));
    expect(onGoToSection).toHaveBeenCalledWith("subsubsubsub");
    fireEvent.click(screen.getByRole("button", { name: "New thread on REQ-00003 Sub" }));
    expect(screen.getByRole("button", { name: /^First\./ }).getAttribute("aria-expanded")).toBe("false");
    const editor = screen.getByRole("textbox", { name: "New thread on REQ-00003 Sub" });
    fireEvent.change(editor, { target: { value: "Second." } });
    fireEvent.blur(editor);
    await waitFor(() => expect(changeComments).toHaveBeenCalledWith("docs/a.md", { op: "add-thread", sectionUid: "subsubsubsub", text: "Second." }, undefined));
    expect(await screen.findByRole("button", { name: /^Second\./ })).toBeDefined();
  });

  test("a resolved thread offers only Reopen and Delete thread", async () => {
    setup([thread("threadresolv", "subsubsubsub", ["Done.", "Yes."], "Resolved")], { filter: "all" });
    fireEvent.click(await screen.findByRole("button", { name: /^Done\./ }));
    const card = screen.getByRole("article", { name: "Thread: Done." });
    expect(within(card).queryByRole("button", { name: "Reply" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Reopen" })).toBeDefined();
    expect(within(card).getByRole("button", { name: "Delete thread" })).toBeDefined();
  });

  test("a first comment with replies can't be deleted alone; Delete thread asks first", async () => {
    const { changeComments } = setup([thread("threadsubaaa", "subsubsubsub", ["First.", "Reply."])]);
    fireEvent.click(await screen.findByRole("button", { name: /^First\./ }));
    const card = screen.getByRole("article", { name: "Thread: First." });
    expect(within(card).getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(within(card).getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    fireEvent.click(within(card).getByRole("button", { name: "Delete thread" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete thread" });
    expect(changeComments).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete thread" }));
    await waitFor(() => expect(changeComments).toHaveBeenCalledWith("docs/a.md", { op: "delete-thread", threadUid: "threadsubaaa" }, undefined));
  });

  test("comments show links and images as text, never as elements", async () => {
    setup([thread("threadsubaaa", "subsubsubsub", ["See [the spec](https://x.example) ![shot](https://x.example/s.png)"])]);
    fireEvent.click(await screen.findByRole("button", { name: /^See / }));
    const card = screen.getByRole("article", { name: /Thread:/ });
    expect(card.querySelector("a")).toBeNull();
    expect(card.querySelector("img")).toBeNull();
    expect(card.textContent).toContain("the spec (https://x.example) shot (https://x.example/s.png)");
  });

  test("without a document, it says so", () => {
    setup([], { body: null });
    expect(screen.getByText("Open a document to see its comment threads.")).toBeDefined();
  });
});
