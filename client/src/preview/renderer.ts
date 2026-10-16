import type { Root } from "hast";
import { codeFileToHast, markdownToHast } from "@specquer/shared/markdown";

/**
 * Turns Markdown into an HTML syntax tree in a Web Worker, so typing in the split view stays
 * smooth, and a text file into a code block (Step 014). Falls back to the main thread where
 * workers aren't available (tests), without highlighting: the grammars load in the worker only.
 */
export interface PreviewRenderer {
  render(markdown: string): Promise<Root>;
  renderCode(text: string, language: string | undefined): Promise<Root>;
  dispose(): void;
}

type Job = { markdown: string } | { code: { text: string; language: string | undefined } };

/** Where the server serves the bundled worker (Bun's HTML bundling doesn't bundle workers). */
export const PREVIEW_WORKER_URL = "/_specquer/preview-worker.js";

const mainThread: PreviewRenderer = {
  render: async (markdown) => markdownToHast(markdown),
  renderCode: async (text, language) => codeFileToHast(text, language),
  dispose: () => {},
};

const onMainThread = (job: Job) => ("code" in job ? mainThread.renderCode(job.code.text, job.code.language) : mainThread.render(job.markdown));

export function createPreviewRenderer(): PreviewRenderer {
  let worker: Worker | null = null;
  try {
    if (typeof Worker !== "undefined") worker = new Worker(PREVIEW_WORKER_URL, { type: "module" });
  } catch {
    worker = null;
  }
  if (worker === null) return mainThread;

  let nextId = 0;
  let failed = false;
  const pending = new Map<number, { job: Job; resolve: (tree: Root) => void; reject: (err: Error) => void }>();
  const w = worker;
  // If the worker can't load, render on the main thread from then on
  w.onerror = () => {
    failed = true;
    w.terminate();
    for (const request of pending.values()) onMainThread(request.job).then(request.resolve, request.reject);
    pending.clear();
  };
  w.onmessage = (event: MessageEvent<{ id: number; tree?: Root; error?: string }>) => {
    const request = pending.get(event.data.id);
    if (request === undefined) return;
    pending.delete(event.data.id);
    if (event.data.tree) request.resolve(event.data.tree);
    else request.reject(new Error(event.data.error ?? "Preview failed"));
  };
  const run = (job: Job): Promise<Root> => {
    if (failed) return onMainThread(job);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { job, resolve, reject });
      w.postMessage({ id, ...job });
    });
  };
  return {
    render: (markdown) => run({ markdown }),
    renderCode: (text, language) => run({ code: { text, language } }),
    dispose() {
      w.terminate();
      pending.clear();
    },
  };
}
