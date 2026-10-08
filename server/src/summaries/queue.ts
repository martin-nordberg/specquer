/**
 * The model call queue: at most `concurrency` calls at once; requests with the same key share
 * one call; a call whose requests were all aborted is dropped if it hasn't started, and aborted
 * if it has.
 */

interface Entry {
  key: string;
  task: (signal: AbortSignal) => Promise<unknown>;
  controller: AbortController;
  /** Requests still waiting for the result. */
  waiters: number;
  started: boolean;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class CallQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly waiting: Entry[] = [];
  private running = 0;

  constructor(private readonly concurrency: () => number) {}

  /** Calls running now. */
  get active(): number {
    return this.running;
  }

  /** Runs `task` for `key`, or joins the call already queued or running for it. */
  run<T>(key: string, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    let entry = this.entries.get(key);
    if (entry === undefined) {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // Nobody may be listening when a dropped call rejects
      promise.catch(() => undefined);
      entry = { key, task, controller: new AbortController(), waiters: 0, started: false, promise, resolve, reject };
      this.entries.set(key, entry);
      this.waiting.push(entry);
    }
    entry.waiters++;
    const joined = entry;
    const result = joined.promise as Promise<T>;
    this.pump();
    if (signal === undefined) return result;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(signal.reason);
        this.leave(joined);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      result.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  private leave(entry: Entry): void {
    entry.waiters--;
    if (entry.waiters > 0) return;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    if (!entry.started) {
      const index = this.waiting.indexOf(entry);
      if (index !== -1) this.waiting.splice(index, 1);
      entry.reject(new DOMException("Dropped", "AbortError"));
    } else entry.controller.abort(new DOMException("Aborted", "AbortError"));
  }

  private pump(): void {
    while (this.running < Math.max(1, this.concurrency()) && this.waiting.length > 0) {
      const entry = this.waiting.shift()!;
      entry.started = true;
      this.running++;
      Promise.resolve()
        .then(() => entry.task(entry.controller.signal))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.running--;
          if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
          this.pump();
        });
    }
  }
}
