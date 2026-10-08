import type { SummaryRequest } from "@specquer/shared/api";
import { simplifySectionText } from "@specquer/shared/summaries";
import { ApiRequestError, type Api } from "@/lib/api";

/**
 * The summaries the preview shows, kept in memory by document, headings and simplified text, so
 * moving the slider back and forth makes no requests. The preview says which sections it needs;
 * requests no longer needed (the slider moved, another file opened) are aborted.
 */

export type SummaryEntry =
  | { state: "loading" }
  | { state: "done"; summary: string; truncated: boolean; model: string }
  | { state: "error"; message: string };

/** The key of a request: its document, its headings and its simplified text. */
export function summaryKey(request: SummaryRequest): string {
  return JSON.stringify([request.path, request.headings, simplifySectionText(request.text)]);
}

/**
 * Summary requests in flight at once. Browsers allow about six connections to a server, and a
 * summary can take many seconds: without a limit, a document with many sections would hold them
 * all and every other request (saves, opening files) would wait behind the summaries.
 */
export const MAX_IN_FLIGHT = 3;

export class SummaryStore {
  private entries: ReadonlyMap<string, SummaryEntry> = new Map();
  private readonly controllers = new Map<string, AbortController>();
  /** Requests waiting for a free slot, in the order the preview needs them. */
  private queued: Array<{ key: string; request: SummaryRequest; controller: AbortController }> = [];
  private inFlight = 0;
  private readonly requests = new Map<string, SummaryRequest>();
  private needed = new Set<string>();
  private listeners = new Set<() => void>();

  constructor(private readonly api: Api) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The entries by key; a new map after every change. */
  get = () => this.entries;

  private update(key: string, entry: SummaryEntry | undefined) {
    const next = new Map(this.entries);
    if (entry === undefined) next.delete(key);
    else next.set(key, entry);
    this.entries = next;
    for (const listener of this.listeners) listener();
  }

  /** Sets the sections the preview shows: missing summaries are requested, unneeded requests aborted. */
  need(requests: readonly SummaryRequest[]): void {
    const keys = new Map(requests.map((request) => [summaryKey(request), request]));
    this.needed = new Set(keys.keys());
    for (const [key, controller] of [...this.controllers]) {
      if (this.needed.has(key)) continue;
      controller.abort(new DOMException("No longer needed", "AbortError"));
      this.controllers.delete(key);
      this.queued = this.queued.filter((entry) => entry.controller !== controller);
      // Requested again when needed again
      this.update(key, undefined);
    }
    for (const [key, request] of keys) {
      this.requests.set(key, request);
      if (!this.entries.has(key)) this.start(key, request);
    }
  }

  /** Requests a summary again after an error. */
  retry(key: string): void {
    const request = this.requests.get(key);
    if (request !== undefined && this.entries.get(key)?.state === "error") this.start(key, request);
  }

  private start(key: string, request: SummaryRequest): void {
    const controller = new AbortController();
    this.controllers.set(key, controller);
    this.update(key, { state: "loading" });
    this.queued.push({ key, request, controller });
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.queued.length > 0) {
      const { key, request, controller } = this.queued.shift()!;
      this.inFlight++;
      this.send(key, request, controller).finally(() => {
        this.inFlight--;
        this.pump();
      });
    }
  }

  private send(key: string, request: SummaryRequest, controller: AbortController): Promise<void> {
    return this.api.summarize(request, controller.signal).then(
      (result) => {
        if (this.controllers.get(key) !== controller) return;
        this.controllers.delete(key);
        this.update(key, { state: "done", summary: result.summary, truncated: result.truncated, model: result.model });
      },
      (err: unknown) => {
        if (this.controllers.get(key) !== controller) return;
        this.controllers.delete(key);
        const message = err instanceof ApiRequestError || err instanceof Error ? err.message : String(err);
        this.update(key, { state: "error", message });
      },
    );
  }
}
