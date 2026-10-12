/**
 * The model call queue: at most `concurrency` calls at once; requests with the same key share
 * one call; a call whose requests were all aborted is dropped if it hasn't started. One that has
 * started runs to the end (its result is cached, and a request for it joins it), since the work
 * is under way and the slider often comes back.
 *
 * Calls are interactive (the preview waits for them) or background (pre-filling). Waiting
 * interactive calls start first, and background calls take at most `concurrency - 1` slots (at
 * least one), so an interactive call never waits for more than the calls already running
 * (Step 005, D6). An interactive request that joins a waiting background call promotes it.
 */

export type Priority = "interactive" | "background";

interface Entry {
  key: string;
  task: () => Promise<unknown>;
  /** Requests still waiting for the result. */
  waiters: number;
  started: boolean;
  priority: Priority;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class CallQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly queued: Entry[] = [];
  private running = 0;
  private runningBackground = 0;

  constructor(private readonly concurrency: () => number) {}

  /** Calls running now. */
  get active(): number {
    return this.running;
  }

  /** Calls waiting to start. */
  get waiting(): number {
    return this.queued.length;
  }

  /** Runs `task` for `key`, or joins the call already queued or running for it. */
  run<T>(key: string, task: () => Promise<T>, signal?: AbortSignal, priority: Priority = "interactive"): Promise<T> {
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
      entry = { key, task, waiters: 0, started: false, priority, promise, resolve, reject };
      this.entries.set(key, entry);
      this.queued.push(entry);
    }
    entry.waiters++;
    if (priority === "interactive") entry.priority = "interactive";
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
    if (entry.waiters > 0 || entry.started) return;
    this.entries.delete(entry.key);
    const index = this.queued.indexOf(entry);
    if (index !== -1) this.queued.splice(index, 1);
    entry.reject(new DOMException("Dropped", "AbortError"));
  }

  /** The next call to start: the first interactive one, else the first background one if a slot is left for it. */
  private next(): Entry | undefined {
    const concurrency = Math.max(1, this.concurrency());
    if (this.running >= concurrency) return undefined;
    const interactive = this.queued.findIndex((entry) => entry.priority === "interactive");
    if (interactive !== -1) return this.queued.splice(interactive, 1)[0];
    if (this.runningBackground >= Math.max(1, concurrency - 1) || this.queued.length === 0) return undefined;
    return this.queued.shift();
  }

  private pump(): void {
    for (let entry = this.next(); entry !== undefined; entry = this.next()) {
      const background = entry.priority === "background";
      const started = entry;
      started.started = true;
      this.running++;
      if (background) this.runningBackground++;
      Promise.resolve()
        .then(() => started.task())
        .then(started.resolve, started.reject)
        .finally(() => {
          this.running--;
          if (background) this.runningBackground--;
          if (this.entries.get(started.key) === started) this.entries.delete(started.key);
          this.pump();
        });
    }
  }
}
