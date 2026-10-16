import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { ChevronDown, ChevronRight, MessageCirclePlus, Pencil, RotateCcw, Trash2, X, Check } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import type { SectionStatusLists } from "@specquer/shared/api";
import { type CommentFilter, type CommentView, type ThreadView, commentFilters, firstLine } from "@specquer/shared/comments";
import { commentToHast } from "@specquer/shared/markdown";
import { type ThreadGroup, groupThreads } from "@/app/comment-groups";
import type { CommentState, CommentStore } from "@/app/comment-store";
import { statusLabel } from "@/app/section-status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CommentEditor } from "./CommentEditor";

/** A time stored in UTC, in the browser's locale (R2.3). */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const FILTER_LABELS: Record<CommentFilter, string> = { open: "Open", resolved: "Resolved", all: "All" };

/** A comment's text: the restricted Markdown, with no links, images or raw HTML (R2.10). */
export function CommentText({ text }: { text: string }) {
  const content = useMemo(() => toJsxRuntime(commentToHast(text), { Fragment, jsx, jsxs }) as ReactNode, [text]);
  return <div className="markdown comment-text text-sm">{content}</div>;
}

export interface CommentsPaneProps {
  state: CommentState;
  store: CommentStore;
  /** The open document's body as it is being edited, or `null` when none is open. */
  body: string | null;
  /** A file other than Markdown is open, which can't have threads (Step 014, R3.7). */
  viewOnly?: boolean;
  lists?: SectionStatusLists;
  filter: CommentFilter;
  onFilterChange: (filter: CommentFilter) => void;
  /** Scrolls the document to a section and flashes it. */
  onGoToSection: (sectionUid: string) => void;
}

/**
 * The Comments pane (Step 012, R7): the open document's threads, grouped by section in document
 * order, filtered by status, with the threads whose section is gone last, as **Detached**.
 */
export function CommentsPane({ state, store, body, viewOnly = false, lists, filter, onFilterChange, onGoToSection }: CommentsPaneProps) {
  const include = state.editing?.kind === "new-thread" ? state.editing.sectionUid : undefined;
  const grouped = useMemo(
    () => (body === null ? null : groupThreads(body, state.threads, filter, lists, include)),
    [body, state.threads, filter, lists, include],
  );
  const list = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState<ThreadView | null>(null);

  // Brings a section's group or a thread into view when asked (a pip, a badge's menu, F8)
  useEffect(() => {
    const reveal = state.reveal;
    if (reveal === null || list.current === null) return;
    // Following the document never moves the pane under the pointer or the focus
    if (reveal.follow === true && (list.current.matches(":hover") || list.current.contains(document.activeElement))) return;
    const selector = reveal.threadUid !== undefined ? `[data-thread-uid="${reveal.threadUid}"]` : `[data-section-group="${reveal.sectionUid}"]`;
    const element = list.current.querySelector<HTMLElement>(selector);
    if (reveal.follow === true) {
      if (element !== null) list.current.scrollTo({ top: element.offsetTop });
      return;
    }
    element?.scrollIntoView({ block: "nearest" });
    if (reveal.threadUid !== undefined) element?.querySelector<HTMLElement>("[data-thread-toggle]")?.focus();
  }, [state.reveal]);

  const empty = (message: string) => <p className="p-4 text-sm text-muted-foreground">{message}</p>;
  let content: ReactNode;
  if (body === null) content = empty(viewOnly ? "Comments are available for Markdown files in sectioned folders." : "Open a document to see its comment threads.");
  else if (!state.loaded) content = empty("Loading…");
  else if (state.loadError !== null) content = empty(`The comments couldn't be loaded: ${state.loadError}`);
  else if (!state.available) content = empty("This file can't have comment threads: it isn't in a sectioned folder.");
  else if (state.unusable !== null) content = empty(`The comment file can't be used: ${state.unusable} See Section problems.`);
  else if (grouped !== null && grouped.groups.length === 0 && grouped.detached.length === 0) {
    content = empty(
      filter === "all"
        ? "No comment threads yet. Start one from a section badge's menu: Add comment…"
        : `No ${FILTER_LABELS[filter].toLowerCase()} threads.`,
    );
  } else if (grouped !== null) {
    content = (
      <>
        {grouped.groups.map((group) => (
          <Group key={group.sectionUid} group={group} state={state} store={store} onGoToSection={onGoToSection} onDelete={setDeleting} />
        ))}
        {grouped.detached.length > 0 && (
          <section aria-label="Detached threads" className="border-t px-3 py-2">
            <h3 className="text-sm font-semibold">Detached</h3>
            <p className="mb-2 text-xs text-muted-foreground">Their sections are no longer in this document.</p>
            <div className="grid gap-2">
              {grouped.detached.map((thread) => (
                <ThreadCard key={thread.threadUid} thread={thread} state={state} store={store} detached onDelete={setDeleting} />
              ))}
            </div>
          </section>
        )}
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Comments</h2>
        <div role="radiogroup" aria-label="Show threads" className="flex rounded-md border p-0.5">
          {commentFilters.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filter === value}
              className={cn(
                "rounded-sm px-2 py-0.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                filter === value ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
              onClick={() => onFilterChange(value)}
            >
              {FILTER_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      {grouped !== null && grouped.hidden > 0 && state.available && (
        <p className="shrink-0 px-3 pt-1 text-xs text-muted-foreground">
          {grouped.hidden} {grouped.hidden === 1 ? "thread" : "threads"} hidden by the filter
        </p>
      )}
      {state.notice !== null && (
        <div role="alert" className="mx-3 mt-2 flex shrink-0 items-start gap-2 rounded-md border border-error-text/40 px-2 py-1 text-sm text-error-text">
          <span className="flex-1">{state.notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => store.dismissNotice()}>
            <X className="size-4" />
          </button>
        </div>
      )}
      <div ref={list} className="relative min-h-0 flex-1 overflow-auto" data-testid="comment-groups">
        {content}
      </div>
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete thread</DialogTitle>
            <DialogDescription>
              Delete this thread and its {deleting?.comments.length === 1 ? "comment" : `${deleting?.comments.length ?? 0} comments`}? This can't be undone in Specquer.
            </DialogDescription>
          </DialogHeader>
          {deleting !== null && <p className="text-sm">“{firstLine(deleting.comments[0]!.text)}”</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (deleting !== null) void store.deleteThread(deleting.threadUid);
                setDeleting(null);
              }}
            >
              Delete thread
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Group({
  group,
  state,
  store,
  onGoToSection,
  onDelete,
}: {
  group: ThreadGroup;
  state: CommentState;
  store: CommentStore;
  onGoToSection: (sectionUid: string) => void;
  onDelete: (thread: ThreadView) => void;
}) {
  const writing = state.editing?.kind === "new-thread" && state.editing.sectionUid === group.sectionUid;
  const highlighted = state.highlight?.from === "pip" && state.highlight.uid === group.sectionUid;
  const label = group.sectionId === null ? group.title : `${group.sectionId} ${group.title}`;
  return (
    <section
      aria-label={`Threads on ${label}`}
      data-section-group={group.sectionUid}
      className={cn("border-b px-3 py-2", highlighted && "bg-comment-highlight")}
      onMouseEnter={() => store.setHighlight({ uid: group.sectionUid, from: "pane" })}
      onMouseLeave={() => store.setHighlight(null)}
      onFocus={() => store.setHighlight({ uid: group.sectionUid, from: "pane" })}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) store.setHighlight(null);
      }}
    >
      <div className="mb-2 flex items-start gap-2">
        <button type="button" className="min-w-0 flex-1 text-left text-sm hover:underline" onClick={() => onGoToSection(group.sectionUid)}>
          {group.sectionId !== null && <span className="font-mono text-xs text-muted-foreground">{group.sectionId} </span>}
          <span className="font-semibold">{group.title}</span>
        </button>
        {group.status !== undefined && <StatusChip>{statusLabel(group.status)}</StatusChip>}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-1.5"
          aria-label={`New thread on ${label}`}
          title="New thread"
          disabled={writing}
          onClick={() => store.startThread(group.sectionUid)}
        >
          <MessageCirclePlus />
        </Button>
      </div>
      <div className="grid gap-2">
        {writing && (
          <CommentEditor
            key={`new:${state.editSession}`}
            initial=""
            label={`New thread on ${label}`}
            onSave={(text, close) => void store.save(text, close)}
            onCancel={() => store.cancelEdit()}
            registerDraft={(draft) => store.setDraftSource(draft)}
          />
        )}
        {group.threads.map((thread) => (
          <ThreadCard key={thread.threadUid} thread={thread} state={state} store={store} onDelete={onDelete} />
        ))}
      </div>
    </section>
  );
}

function StatusChip({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{children}</span>;
}

function ThreadCard({
  thread,
  state,
  store,
  detached = false,
  onDelete,
}: {
  thread: ThreadView;
  state: CommentState;
  store: CommentStore;
  detached?: boolean;
  onDelete: (thread: ThreadView) => void;
}) {
  const expanded = state.expanded.has(thread.threadUid);
  const resolved = thread.status === "Resolved";
  const first = thread.comments[0]!;
  const replies = thread.comments.length - 1;
  const editing = state.editing !== null && "threadUid" in state.editing && state.editing.threadUid === thread.threadUid ? state.editing : null;
  const readOnly = resolved || detached;
  const summary = firstLine(first.text);
  return (
    <article
      aria-label={`Thread: ${summary}`}
      data-thread-uid={thread.threadUid}
      className={cn("rounded-md border bg-card text-card-foreground", resolved && "opacity-80")}
    >
      <button
        type="button"
        data-thread-toggle
        aria-expanded={expanded}
        className="flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => store.toggle(thread.threadUid)}
      >
        {expanded ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{summary || "(empty)"}</span>
          <span className="block text-xs text-muted-foreground">
            {first.createdBy} · {replies === 0 ? "no replies" : replies === 1 ? "1 reply" : `${replies} replies`}
          </span>
        </span>
        <StatusChip>{thread.status}</StatusChip>
      </button>
      {expanded && (
        <div className="grid gap-2 border-t px-2 py-2">
          {thread.comments.map((comment, index) =>
            editing?.kind === "edit" && editing.commentUid === comment.commentUid ? (
              <CommentEditor
                key={`edit:${state.editSession}`}
                initial={comment.text}
                label={`Edit the comment by ${comment.createdBy}`}
                onSave={(text, close) => void store.save(text, close)}
                onCancel={() => store.cancelEdit()}
                registerDraft={(draft) => store.setDraftSource(draft)}
              />
            ) : (
              <CommentItem
                key={comment.commentUid}
                comment={comment}
                readOnly={readOnly}
                // A first comment with replies goes only with its thread (R2.9)
                deletable={index > 0 || thread.comments.length === 1}
                onEdit={() => store.startEdit(thread.threadUid, comment.commentUid)}
                onDelete={() => (index === 0 ? onDelete(thread) : void store.deleteComment(thread.threadUid, comment.commentUid))}
              />
            ),
          )}
          {thread.statusChangedBy !== undefined && thread.statusChangedAt !== undefined && (
            <p className="text-xs text-muted-foreground">
              {resolved ? "Resolved" : "Reopened"} by {thread.statusChangedBy}, {formatTime(thread.statusChangedAt)}
            </p>
          )}
          {editing?.kind === "reply" && (
            <CommentEditor
              key={`reply:${state.editSession}`}
              initial=""
              label="Reply"
              onSave={(text, close) => void store.save(text, close)}
              onCancel={() => store.cancelEdit()}
              registerDraft={(draft) => store.setDraftSource(draft)}
            />
          )}
          <div className="flex flex-wrap gap-1">
            {!readOnly && editing?.kind !== "reply" && (
              <Button type="button" size="sm" variant="secondary" className="h-7" onClick={() => store.startReply(thread.threadUid)}>
                Reply
              </Button>
            )}
            {resolved ? (
              <Button type="button" size="sm" variant="secondary" className="h-7" onClick={() => void store.setStatus(thread.threadUid, "Open")}>
                <RotateCcw /> Reopen
              </Button>
            ) : (
              <Button type="button" size="sm" variant="secondary" className="h-7" onClick={() => void store.setStatus(thread.threadUid, "Resolved")}>
                <Check /> Resolve
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => onDelete(thread)}>
              <Trash2 /> Delete thread
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function CommentItem({
  comment,
  readOnly,
  deletable,
  onEdit,
  onDelete,
}: {
  comment: CommentView;
  readOnly: boolean;
  deletable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group grid gap-0.5" data-comment-uid={comment.commentUid}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{comment.createdBy}</span>
        <time dateTime={comment.createdAt}>{formatTime(comment.createdAt)}</time>
        {comment.updatedAt !== undefined && (
          <span title={`Edited by ${comment.updatedBy ?? ""}, ${formatTime(comment.updatedAt)}`}>· edited</span>
        )}
        {!readOnly && (
          <span className="ml-auto flex gap-0.5">
            <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5" aria-label="Edit" title="Edit" onClick={onEdit}>
              <Pencil />
            </Button>
            {deletable && (
              <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5" aria-label="Delete" title="Delete" onClick={onDelete}>
                <Trash2 />
              </Button>
            )}
          </span>
        )}
      </div>
      <CommentText text={comment.text} />
    </div>
  );
}
