/// <reference lib="webworker" />
import { markdownToHast } from "@specquer/shared/markdown";

/** Runs the shared preview pipeline off the main thread. */
self.onmessage = (event: MessageEvent<{ id: number; markdown: string }>) => {
  const { id, markdown } = event.data;
  try {
    self.postMessage({ id, tree: markdownToHast(markdown) });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};
