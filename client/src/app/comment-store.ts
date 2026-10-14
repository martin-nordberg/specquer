import type { CommentChange, CommentChangeResult, ThreadStatus, ThreadView } from "@specquer/shared/comments";
import type { Api } from "@/lib/api";

/**
 * The Comments pane's state (Step 012), apart from React: the open document's threads as on disk,
 * which threads are expanded, and the comment being written. A comment is saved when its editor
 * loses focus (R2.6); the server applies each change by UIDs and sends back the threads as they
 * are now, which replace what the store holds.
 */

/** What the editor is writing. */
export type CommentEditTarget =
  | { kind: "new-thread"; sectionUid: string }
  | { kind: "reply"; threadUid: string }
  | { kind: "edit"; threadUid: string; commentUid: string };

export interface CommentState {
  path: string | null;
  loaded: boolean;
  /** Whether the open file can have threads (it is sectioned). */
  available: boolean;
  threads: ThreadView[];
  /** Why the sidecar can't be used, if it can't. */
  unusable: string | null;
  loadError: string | null;
  expanded: ReadonlySet<string>;
  editing: CommentEditTarget | null;
  /**
   * Increases each time an editor opens. One editor keeps its session while it saves: a new
   * comment saved without closing (the window lost the focus) becomes an edit of what it created.
   */
  editSession: number;
  /** A refused or failed change, for the pane to show. */
  notice: string | null;
  /** The section highlighted from the pane or from a pip (R6). */
  highlight: { uid: string; from: "pane" | "pip" } | null;
  /** A request to bring a section's group, or a thread, into view in the pane; `n` makes each one new. */
  reveal: { sectionUid?: string; threadUid?: string; n: number } | null;
}

export class CommentStore {
  private state: CommentState = {
    path: null,
    loaded: false,
    available: false,
    threads: [],
    unusable: null,
    loadError: null,
    expanded: new Set(),
    editing: null,
    editSession: 0,
    notice: null,
    highlight: null,
    reveal: null,
  };
  private listeners = new Set<() => void>();
  /** Saves run one after another, so a second save sees what the first one created. */
  private saving: Promise<unknown> = Promise.resolve();
  /** The text in the open editor, for a save when the page closes. */
  private draft: (() => string) | null = null;
  private reveals = 0;

  constructor(private readonly api: Pick<Api, "comments" | "changeComments">) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = () => this.state;

  private set(update: Partial<CommentState>): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }

  /** Shows a file's threads (`null`: none open). */
  async open(path: string | null): Promise<void> {
    if (path !== this.state.path) {
      this.set({ path, loaded: false, available: false, threads: [], unusable: null, loadError: null, expanded: new Set(), editing: null, notice: null, highlight: null });
    }
    await this.load();
  }

  /** Reads the open file's threads again (after a save, or when the window gets focus). */
  async load(): Promise<void> {
    const path = this.state.path;
    if (path === null) return;
    try {
      const response = await this.api.comments(path);
      if (this.state.path !== path) return;
      this.set({ loaded: true, available: response.available, threads: response.threads, unusable: response.unusable ?? null, loadError: null });
    } catch (err) {
      if (this.state.path === path) this.set({ loaded: true, loadError: (err as Error).message });
    }
  }

  private async apply(change: CommentChange, options?: { keepalive?: boolean }): Promise<CommentChangeResult | null> {
    const path = this.state.path;
    if (path === null) return null;
    try {
      const result = await this.api.changeComments(path, change, options);
      if (this.state.path === path) this.set({ threads: result.threads, notice: result.ok ? null : result.message });
      return result;
    } catch (err) {
      if (this.state.path === path) this.set({ notice: (err as Error).message });
      return null;
    }
  }

  dismissNotice(): void {
    if (this.state.notice !== null) this.set({ notice: null });
  }

  toggle(threadUid: string): void {
    const expanded = new Set(this.state.expanded);
    if (!expanded.delete(threadUid)) expanded.add(threadUid);
    this.set({ expanded });
  }

  expand(threadUid: string): void {
    if (!this.state.expanded.has(threadUid)) this.toggle(threadUid);
  }

  /** Starts a new thread on a section, collapsing the section's other threads (R7.4). */
  startThread(sectionUid: string): void {
    const others = new Set(this.state.threads.filter((thread) => thread.sectionUid === sectionUid).map((thread) => thread.threadUid));
    const expanded = new Set([...this.state.expanded].filter((uid) => !others.has(uid)));
    this.edit({ kind: "new-thread", sectionUid }, { expanded });
    this.revealSection(sectionUid);
  }

  startReply(threadUid: string): void {
    this.edit({ kind: "reply", threadUid });
  }

  startEdit(threadUid: string, commentUid: string): void {
    this.edit({ kind: "edit", threadUid, commentUid });
  }

  private edit(editing: CommentEditTarget, update: Partial<CommentState> = {}): void {
    this.set({ ...update, editing, editSession: this.state.editSession + 1, notice: null });
  }

  /** Escape: the editor closes and nothing is saved (R2.7). */
  cancelEdit(): void {
    if (this.state.editing !== null) this.set({ editing: null });
  }

  /** The open editor's text, for a save when the page closes; `null` when it closes. */
  setDraftSource(draft: (() => string) | null): void {
    this.draft = draft;
  }

  /**
   * Saves the editor's text (R2.6). `close` when the focus moved elsewhere in the page; without it
   * (the window lost the focus) the editor stays open, and what it wrote is from then on an edit of
   * the comment it created. A new comment left empty, a cleared comment and an unchanged one write
   * nothing (R2.6, R2.7).
   */
  save(text: string, close: boolean, options?: { keepalive?: boolean }): Promise<void> {
    if (this.state.editing === null) return Promise.resolve();
    const session = this.state.editSession;
    const start = this.state.editing;
    if (close) this.set({ editing: null });
    const run = this.saving.then(() => this.write(start, session, text, close, options));
    this.saving = run.catch(() => undefined);
    return run;
  }

  /** Saves the open editor's text without closing it: the page is closing or the window lost the focus. */
  flush(options?: { keepalive?: boolean }): Promise<void> {
    const text = this.draft?.();
    return text === undefined ? Promise.resolve() : this.save(text, false, options);
  }

  private async write(start: CommentEditTarget, session: number, text: string, close: boolean, options?: { keepalive?: boolean }): Promise<void> {
    const stillEditing = () => !close && this.state.editing !== null && this.state.editSession === session;
    // An earlier save of this editor may have turned a new comment into an edit of what it created
    const target = stillEditing() ? this.state.editing! : start;
    switch (target.kind) {
      case "new-thread":
      case "reply": {
        if (text.trim() === "") return;
        const result = await this.apply(
          target.kind === "new-thread" ? { op: "add-thread", sectionUid: target.sectionUid, text } : { op: "reply", threadUid: target.threadUid, text },
          options,
        );
        if (result?.ok !== true || result.created === undefined) return;
        const created = result.created;
        this.expand(created.threadUid);
        if (stillEditing()) this.set({ editing: { kind: "edit", ...created } });
        return;
      }
      case "edit": {
        const comment = this.state.threads.find((thread) => thread.threadUid === target.threadUid)?.comments.find((c) => c.commentUid === target.commentUid);
        if (comment === undefined || text === comment.text || text.trim() === "") return;
        const result = await this.apply({ op: "edit", threadUid: target.threadUid, commentUid: target.commentUid, text, baseVersion: comment.version }, options);
        // Refused (changed on disk meanwhile): the text is lost, and the editor shows the comment as it is now (R3.3)
        if (result?.ok === false && stillEditing()) this.set({ editing: null });
        return;
      }
    }
  }

  async setStatus(threadUid: string, status: ThreadStatus): Promise<void> {
    if (this.state.editing !== null && "threadUid" in this.state.editing && this.state.editing.threadUid === threadUid) this.set({ editing: null });
    await this.apply({ op: "set-status", threadUid, status });
  }

  async deleteComment(threadUid: string, commentUid: string): Promise<void> {
    await this.apply({ op: "delete-comment", threadUid, commentUid });
  }

  async deleteThread(threadUid: string): Promise<void> {
    if (this.state.editing !== null && "threadUid" in this.state.editing && this.state.editing.threadUid === threadUid) this.set({ editing: null });
    await this.apply({ op: "delete-thread", threadUid });
  }

  setHighlight(highlight: CommentState["highlight"]): void {
    const current = this.state.highlight;
    if (current?.uid === highlight?.uid && current?.from === highlight?.from) return;
    this.set({ highlight });
  }

  revealSection(sectionUid: string): void {
    this.set({ reveal: { sectionUid, n: ++this.reveals } });
  }

  revealThread(threadUid: string): void {
    this.expand(threadUid);
    this.set({ reveal: { threadUid, n: ++this.reveals } });
  }
}
