import type { ChatTurn, Citation } from "@specquer/shared/chat";
import type { Api } from "@/lib/api";
import type { SaveResult } from "./document-store";

/**
 * The chat pane's state (Step 010), apart from React: the stored conversation, the answer under
 * way, and **Clear** with **Undo**. Sending saves the open file first, so the answer is grounded
 * in what the user sees (R2.5).
 */

/** How long **Undo** is offered after clearing. */
export const UNDO_TIME = 10_000;

/** The answer under way, or the last one that failed. */
export interface PendingAnswer {
  question: { text: string; at: string };
  phase: "saving" | "searching" | "thinking" | "streaming" | "failed";
  citations: Citation[];
  text: string;
  error?: string;
  /** When the client sent it, for the time shown if it is stopped. */
  sentAt: number;
}

export interface ChatState {
  turns: ChatTurn[];
  /** Whether the history has been loaded once. */
  loaded: boolean;
  loadError: string | null;
  pending: PendingAnswer | null;
  /** A `/command` that isn't one. */
  unknownCommand: string | null;
  /** The turns just cleared, while **Undo** is offered. */
  undo: ChatTurn[] | null;
  /** The question to put back in the input (a save that failed). */
  draft: string | null;
  /** The last finished answer's text, for the live region. */
  announcement: string;
}

export interface ChatDependencies {
  api: Pick<Api, "chat" | "chatHistory" | "clearChatHistory" | "restoreChatHistory">;
  /** Saves the open file: as autosave does. */
  saveOpenFile(): Promise<SaveResult>;
  /** Resolves once the open file's conflict with the disk has been settled. */
  conflictSettled(): Promise<void>;
  /** The open file's path, if any. */
  openFile(): string | undefined;
  /** The configured model's ID, for an answer stopped before the server named it. */
  model?: () => string | undefined;
  now?: () => number;
}

export class ChatStore {
  private state: ChatState = {
    turns: [],
    loaded: false,
    loadError: null,
    pending: null,
    unknownCommand: null,
    undo: null,
    draft: null,
    announcement: "",
  };
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: ChatDependencies) {
    this.now = deps.now ?? Date.now;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = () => this.state;

  private set(update: Partial<ChatState>): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }

  private setPending(update: Partial<PendingAnswer>): void {
    if (this.state.pending !== null) this.set({ pending: { ...this.state.pending, ...update } });
  }

  get busy(): boolean {
    const phase = this.state.pending?.phase;
    return phase !== undefined && phase !== "failed";
  }

  /** Loads the conversation; skipped while an answer is under way. */
  async load(): Promise<void> {
    if (this.busy) return;
    try {
      const turns = await this.deps.api.chatHistory();
      if (!this.busy) this.set({ turns, loaded: true, loadError: null });
    } catch (err) {
      this.set({ loaded: true, loadError: (err as Error).message });
    }
  }

  /** Sends a question, or runs a `/command`. Does nothing while an answer is under way. */
  async send(input: string): Promise<void> {
    if (this.busy || input.trim() === "") return;
    const command = input.trim();
    if (command.startsWith("/")) {
      if (command === "/clear") {
        this.set({ unknownCommand: null, draft: null });
        await this.clear();
      } else this.set({ unknownCommand: command.split(/\s/)[0]! });
      return;
    }
    this.set({ unknownCommand: null, draft: null });
    await this.ask(input);
  }

  /** Asks the failed question again. */
  async retry(): Promise<void> {
    const pending = this.state.pending;
    if (pending === null || pending.phase !== "failed") return;
    await this.ask(pending.question.text);
  }

  private async ask(question: string): Promise<void> {
    const sentAt = this.now();
    this.set({ pending: { question: { text: question, at: new Date(sentAt).toISOString() }, phase: "saving", citations: [], text: "", sentAt } });

    // Save the open file first; a conflict waits until the user has chosen
    let saved = await this.deps.saveOpenFile();
    if (saved === "conflict") {
      await this.deps.conflictSettled();
      saved = await this.deps.saveOpenFile();
    }
    if (saved === "conflict" || saved === "error") {
      this.set({ pending: null, draft: question });
      return;
    }

    const controller = new AbortController();
    this.controller = controller;
    this.setPending({ phase: "searching" });
    let done: { model: string; elapsedMs: number; at: string } | null = null;
    try {
      const openFile = this.deps.openFile();
      const events = await this.deps.api.chat({ question, ...(openFile === undefined ? {} : { openFile }) }, controller.signal);
      for await (const event of events) {
        if (event.type === "status") this.setPending({ phase: event.phase });
        else if (event.type === "citations") this.setPending({ citations: event.citations });
        else if (event.type === "token") this.setPending({ phase: "streaming", text: (this.state.pending?.text ?? "") + event.text });
        else if (event.type === "done") done = { model: event.model, elapsedMs: event.elapsedMs, at: event.at };
        else {
          this.setPending({ phase: "failed", error: event.message });
          return;
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      this.setPending({ phase: "failed", error: (err as Error).message });
      return;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
    const pending = this.state.pending;
    if (pending === null) return;
    if (done === null) {
      this.setPending({ phase: "failed", error: "The answer ended early." });
      return;
    }
    const turn: ChatTurn = {
      question: pending.question,
      answer: { text: pending.text, model: done.model, elapsedMs: done.elapsedMs, at: done.at, stopped: false, citations: pending.citations },
    };
    this.set({ turns: [...this.state.turns, turn], pending: null, announcement: pending.text });
  }

  /** Stops the answer under way; the text so far stays, marked stopped. */
  stop(): void {
    const pending = this.state.pending;
    if (this.controller === null || pending === null) return;
    this.controller.abort();
    this.controller = null;
    if (pending.text === "") {
      // Nothing to keep: the question goes back to the input
      this.set({ pending: null, draft: pending.question.text });
      return;
    }
    const turn: ChatTurn = {
      question: pending.question,
      answer: {
        text: pending.text,
        model: this.deps.model?.() ?? "",
        elapsedMs: Math.max(0, this.now() - pending.sentAt),
        at: new Date(this.now()).toISOString(),
        stopped: true,
        citations: pending.citations,
      },
    };
    this.set({ turns: [...this.state.turns, turn], pending: null });
  }

  /** Empties the conversation; **Undo** puts it back for a few seconds. */
  async clear(): Promise<void> {
    if (this.busy) return;
    try {
      const cleared = await this.deps.api.clearChatHistory();
      this.set({ turns: [], pending: null, undo: cleared.length > 0 ? cleared : null });
      if (this.undoTimer !== null) clearTimeout(this.undoTimer);
      if (cleared.length > 0) this.undoTimer = setTimeout(() => this.set({ undo: null }), UNDO_TIME);
    } catch (err) {
      this.set({ loadError: (err as Error).message });
    }
  }

  async undoClear(): Promise<void> {
    const turns = this.state.undo;
    if (turns === null) return;
    if (this.undoTimer !== null) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    this.set({ undo: null });
    try {
      this.set({ turns: await this.deps.api.restoreChatHistory(turns) });
    } catch (err) {
      this.set({ loadError: (err as Error).message });
    }
  }

  /** The input took the question back; forget it. */
  takeDraft(): void {
    if (this.state.draft !== null) this.set({ draft: null });
  }

  dismissUnknownCommand(): void {
    if (this.state.unknownCommand !== null) this.set({ unknownCommand: null });
  }

  close(): void {
    this.controller?.abort();
    if (this.undoTimer !== null) clearTimeout(this.undoTimer);
  }
}
