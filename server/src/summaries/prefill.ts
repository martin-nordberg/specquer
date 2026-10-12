import { type SummaryTarget, summaryBody, summaryTargets } from "@specquer/shared/summaries";

/**
 * Background pre-filling (Step 005, §4.5): when switched on, a pass summarizes every section the
 * slider can show, file by file, so the preview finds its summaries made. Within a file the
 * deepest sections go first, so a long section's fallback finds its subsections cached. A file
 * is skipped while its stamp and the model are those of its last complete summarizing.
 *
 * A pass starts `delay` after it is triggered (startup, a change to the files). A trigger while
 * a pass runs makes another pass follow it. A rate limit stops the pass and pauses pre-filling,
 * one `backoff` at first, doubling up to `maxBackoff`.
 */

export interface PrefillHost {
  /** The model's cache key when pre-filling may run (switched on, model and key set), else `undefined`. */
  ready(): Promise<string | undefined>;
  /** How many sections to summarize at once: the queue's background slots. */
  slots(): number;
  /** The Markdown files, in tree order. */
  files(): Promise<string[]>;
  /** A file's modification stamp, or `undefined` when it is gone. */
  stamp(path: string): Promise<string | undefined>;
  read(path: string): Promise<string | undefined>;
  /** Summarizes a section in the background, through the cache; short sections are skipped. */
  summarize(path: string, target: SummaryTarget, signal: AbortSignal): Promise<void>;
  isRateLimit(err: unknown): boolean;
  warn(message: string): void;
}

export interface PrefillTiming {
  delay: number;
  backoff: number;
  maxBackoff: number;
  now: () => number;
}

export const PREFILL_DELAY = 10_000;
export const PREFILL_BACKOFF = 60_000;
export const PREFILL_MAX_BACKOFF = 15 * 60_000;

export class Prefill {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private again = false;
  private pausedUntil = 0;
  private pause = 0;
  private waiting = 0;
  /** Per file, the model and stamp it was last summarized completely with. */
  private readonly done = new Map<string, string>();
  private closed = false;

  constructor(
    private readonly host: PrefillHost,
    private readonly timing: PrefillTiming,
  ) {}

  /** Sections queued or being summarized by the current pass. */
  get pending(): number {
    return this.waiting;
  }

  /** Whether a pass is running. */
  get running(): boolean {
    return this.controller !== null;
  }

  /** Starts a pass after the delay (or once a rate-limit pause is over); one running is followed by another. */
  trigger(): void {
    if (this.closed) return;
    if (this.controller !== null) {
      this.again = true;
      return;
    }
    this.schedule(Math.max(this.timing.delay, this.pausedUntil - this.timing.now()));
  }

  /** The configuration changed: stops the pass (calls not yet started are dropped) and starts again. */
  restart(): void {
    this.controller?.abort(new DOMException("Pre-filling restarted", "AbortError"));
    this.controller = null;
    this.again = false;
    this.trigger();
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort(new DOMException("Closed", "AbortError"));
    this.controller = null;
  }

  private schedule(delay: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pass().catch((err) => this.host.warn(`pre-filling summaries failed: ${(err as Error).message}`));
    }, delay);
  }

  private async pass(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.again = false;
    const { signal } = controller;
    let limited = false;
    try {
      const model = await this.host.ready();
      if (model === undefined) return;
      for (const path of await this.host.files()) {
        if (signal.aborted) return;
        const stamp = await this.host.stamp(path);
        if (stamp === undefined) continue;
        const mark = `${model}\n${stamp}`;
        if (this.done.get(path) === mark) continue;
        const text = await this.host.read(path);
        if (text === undefined) continue;
        const targets = summaryTargets(summaryBody(text));
        this.waiting += targets.length;
        // In order, as many at once as the queue runs in the background
        const failures: unknown[] = [];
        let next = 0;
        const worker = async () => {
          while (next < targets.length && !signal.aborted) {
            const target = targets[next++]!;
            try {
              await this.host.summarize(path, target, signal);
            } catch (err) {
              // Stop at once: the calls still waiting are dropped
              if (this.host.isRateLimit(err) && !limited) {
                limited = true;
                controller.abort(new DOMException("Rate limited", "AbortError"));
              }
              failures.push(err);
            } finally {
              this.waiting--;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.max(1, this.host.slots()) }, worker));
        this.waiting -= targets.length - next;
        if (signal.aborted) return;
        if (failures.length > 0) this.host.warn(`pre-filling summaries for ${path} failed: ${String((failures[0] as Error).message ?? failures[0])}`);
        else this.done.set(path, mark);
      }
      this.pause = 0;
      this.pausedUntil = 0;
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        if (limited) {
          // Try again after the pause
          this.pause = this.pause === 0 ? this.timing.backoff : Math.min(this.pause * 2, this.timing.maxBackoff);
          this.pausedUntil = this.timing.now() + this.pause;
          this.again = false;
          this.schedule(this.pause);
        } else if (this.again) this.trigger();
      }
    }
  }
}
