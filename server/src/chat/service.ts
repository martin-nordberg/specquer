import { type ChatExchange, type ChatSource, chatMessages, estimateTokens, streamAnswer } from "@specquer/agent";
import { ApiError } from "@specquer/shared/api";
import type { ChatEvent, ChatRequest, ChatTurn, Citation } from "@specquer/shared/chat";
import type { FileService } from "../files.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import type { SectionIndex } from "../sections/section-index.ts";
import { isRateLimit } from "../summaries/service.ts";
import { ChatHistoryFile } from "./history.ts";
import { ftsQuery } from "./query.ts";
import { type FoundUnit, SearchIndex, SearchUnavailableError } from "./search-index.ts";

/**
 * Document chat (Step 010): a question is answered from the units the search index finds, with
 * the conversation so far, streamed as events. Chat calls go through the model runtime's queue at
 * interactive priority, never shared and stopped when the request is (decision D1, D2). Answers
 * that end, or are stopped with some text, are kept in the history.
 */

/** How long the index waits after files change before it updates. */
export const INDEX_DELAY = 500;

export interface ChatSources {
  files: FileService;
  sections: SectionIndex;
}

export interface ChatServiceOptions {
  now?: () => number;
  warn?: (message: string) => void;
  /** How long the index waits after files change (500 ms). */
  indexDelay?: number;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export class ChatService {
  readonly index: SearchIndex;
  readonly history: ChatHistoryFile;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private readonly indexDelay: number;
  private indexTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    root: string,
    private readonly runtime: ModelRuntime,
    private readonly sources: ChatSources,
    options: ChatServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? ((message: string) => console.warn(`specquer: ${message}`));
    this.indexDelay = options.indexDelay ?? INDEX_DELAY;
    this.index = new SearchIndex(
      root,
      {
        files: () => sources.files.listMarkdownFiles(),
        stamp: async (path) => {
          const stamp = await sources.files.fileStamp(path);
          return stamp === undefined ? undefined : `${stamp.mtimeMs}:${stamp.size}`;
        },
        read: (path) => sources.files.readFile(path).then((file) => file.text, () => undefined),
      },
      this.now,
      this.warn,
    );
    this.history = new ChatHistoryFile(root, this.now, this.warn);
  }

  /** Builds or updates the search index in the background, now (at startup). */
  startIndexing(): void {
    this.index.update().catch((err) => {
      if (!(err instanceof SearchUnavailableError)) this.warn(`indexing for chat failed: ${(err as Error).message}`);
    });
  }

  /** Updates the search index shortly after files change; a question updates it first anyway. */
  filesChanged(): void {
    if (this.indexTimer !== null) clearTimeout(this.indexTimer);
    this.indexTimer = setTimeout(() => {
      this.indexTimer = null;
      this.startIndexing();
    }, this.indexDelay);
    // Never what keeps the process alive
    this.indexTimer.unref?.();
  }

  /**
   * Answers a question, as a stream of events. Without a model it throws `503` before the stream
   * starts; later failures are `error` events. `signal` stops the answer: nothing more is sent,
   * and the text so far is kept as a stopped answer.
   */
  async ask(request: ChatRequest, signal: AbortSignal): Promise<AsyncIterable<ChatEvent>> {
    const { config, chatModel: model } = await this.runtime.current();
    if (!model.ok) throw new ApiError(503, "not_configured", model.problem);
    const started = this.now();
    return this.answer(request, signal, started, config.chat, model);
  }

  private async *answer(
    request: ChatRequest,
    signal: AbortSignal,
    started: number,
    settings: { units: number; contextTokens: number; historyTurns: number; historyTokens: number; answerTokens: number },
    model: Extract<Awaited<ReturnType<ModelRuntime["current"]>>["model"], { ok: true }>,
  ): AsyncGenerator<ChatEvent> {
    yield { type: "status", phase: "searching" };
    const turns = await this.history.read();
    let units: FoundUnit[];
    try {
      units = await this.index.search(ftsQuery(request.question, turns.at(-1)?.question.text), {
        ...(request.openFile === undefined ? {} : { openFile: request.openFile }),
        units: settings.units,
        contextTokens: settings.contextTokens,
      });
    } catch (err) {
      if (err instanceof SearchUnavailableError) {
        yield { type: "error", code: "search_unavailable", message: err.message };
        return;
      }
      throw err;
    }
    if (signal.aborted) return;
    const citations = await this.citations(units);
    yield { type: "citations", citations };
    yield { type: "status", phase: "thinking" };

    const sources: ChatSource[] = units.map((unit, index) => ({
      n: index + 1,
      path: unit.path,
      ...(citations[index]!.sectionId === undefined ? {} : { sectionId: citations[index]!.sectionId }),
      title: unit.title,
      headings: unit.headings,
      text: unit.text,
    }));
    const messages = chatMessages({ question: request.question, sources, history: recentHistory(turns, settings) });

    // The model's pieces arrive through the queue's task; this generator hands them on
    const pieces: string[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let failure: unknown;
    this.runtime.queue
      .run(
        `chat:${crypto.randomUUID()}`,
        async (callSignal) => {
          for await (const piece of streamAnswer(model.model, messages, callSignal)) {
            pieces.push(piece);
            wake?.();
          }
        },
        signal,
        "interactive",
        { abortable: true },
      )
      .then(
        () => undefined,
        (err: unknown) => {
          failure = err;
        },
      )
      .finally(() => {
        finished = true;
        wake?.();
      });

    let text = "";
    for (;;) {
      const waiting = new Promise<void>((resolve) => {
        wake = resolve;
      });
      while (pieces.length > 0 && !signal.aborted) {
        const piece = pieces.shift()!;
        text += piece;
        yield { type: "token", text: piece };
      }
      if (finished || signal.aborted) break;
      await waiting;
    }

    const answer = (stopped: boolean) => ({
      text,
      model: model.id,
      elapsedMs: Math.max(0, this.now() - started),
      at: new Date(this.now()).toISOString(),
      stopped,
      citations,
    });
    const question = { text: request.question, at: new Date(started).toISOString() };
    if (signal.aborted) {
      // Stopped: the text so far is kept, marked stopped; nothing more is sent
      if (text !== "") await this.store({ question, answer: answer(true) });
      return;
    }
    if (failure !== undefined && !isAbort(failure)) {
      yield isRateLimit(failure)
        ? { type: "error", code: "rate_limited", message: "The model provider's rate limit was reached. Try again in a minute." }
        : { type: "error", code: "provider_error", message: `The model provider failed: ${String((failure as Error).message ?? failure).split("\n")[0]}` };
      return;
    }
    const done = answer(false);
    await this.store({ question, answer: done });
    yield { type: "done", model: done.model, elapsedMs: done.elapsedMs, at: done.at };
  }

  /**
   * The citations for the retrieved units, numbered as the prompt numbers them. A unit's anchor ID
   * is kept as the section ID only if the section index holds it in that file now: a
   * non-sectioned file can hold copied anchors, and a folder's type can change.
   */
  private async citations(units: FoundUnit[]): Promise<Citation[]> {
    const known = new Map<string, Set<string>>();
    for (const path of new Set(units.filter((unit) => unit.anchorId !== undefined).map((unit) => unit.path))) {
      try {
        known.set(path, new Set((await this.sources.sections.sectionsOf(path)).map((section) => section.id).filter((id): id is string => id !== null)));
      } catch {
        known.set(path, new Set());
      }
    }
    return units.map((unit, index) => ({
      n: index + 1,
      path: unit.path,
      outlinePath: unit.outlinePath,
      ...(unit.anchorId !== undefined && known.get(unit.path)?.has(unit.anchorId) ? { sectionId: unit.anchorId } : {}),
      title: unit.title,
    }));
  }

  private async store(turn: ChatTurn): Promise<void> {
    try {
      await this.history.append(turn);
    } catch (err) {
      this.warn(`saving the chat history failed: ${(err as Error).message}`);
    }
  }

  close(): void {
    if (this.indexTimer !== null) clearTimeout(this.indexTimer);
    this.index.close();
  }
}

/** The earlier turns sent with a question: the newest within the limits, oldest first (R6.3). */
export function recentHistory(turns: ChatTurn[], limits: { historyTurns: number; historyTokens: number }): ChatExchange[] {
  const kept: ChatExchange[] = [];
  let tokens = 0;
  for (const turn of turns.slice().reverse()) {
    if (kept.length >= limits.historyTurns) break;
    const cost = estimateTokens(turn.question.text) + estimateTokens(turn.answer.text);
    if (tokens + cost > limits.historyTokens) break;
    tokens += cost;
    kept.push({ question: turn.question.text, answer: turn.answer.text });
  }
  return kept.reverse();
}
