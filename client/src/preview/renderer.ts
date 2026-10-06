import type { Root } from "hast";
import { markdownToHast } from "@specquer/shared/markdown";

/**
 * Turns Markdown into an HTML syntax tree in a Web Worker, so typing in the split view stays
 * smooth. Falls back to the main thread where workers aren't available (tests).
 */
export interface PreviewRenderer {
  render(markdown: string): Promise<Root>;
  dispose(): void;
}

/** Where the server serves the bundled worker (Bun's HTML bundling doesn't bundle workers). */
export const PREVIEW_WORKER_URL = "/_specquer/preview-worker.js";

const mainThread: PreviewRenderer = { render: async (markdown) => markdownToHast(markdown), dispose: () => {} };

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
  const pending = new Map<number, { markdown: string; resolve: (tree: Root) => void; reject: (err: Error) => void }>();
  const w = worker;
  // If the worker can't load, render on the main thread from then on
  w.onerror = () => {
    failed = true;
    w.terminate();
    for (const request of pending.values()) mainThread.render(request.markdown).then(request.resolve, request.reject);
    pending.clear();
  };
  w.onmessage = (event: MessageEvent<{ id: number; tree?: Root; error?: string }>) => {
    const request = pending.get(event.data.id);
    if (request === undefined) return;
    pending.delete(event.data.id);
    if (event.data.tree) request.resolve(event.data.tree);
    else request.reject(new Error(event.data.error ?? "Preview failed"));
  };
  return {
    render(markdown) {
      if (failed) return mainThread.render(markdown);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { markdown, resolve, reject });
        w.postMessage({ id, markdown });
      });
    },
    dispose() {
      w.terminate();
      pending.clear();
    },
  };
}
