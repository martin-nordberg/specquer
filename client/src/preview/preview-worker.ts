/// <reference lib="webworker" />
import { highlightedCodeFileToHast, highlightedMarkdownToHast } from "@specquer/shared/highlight";

/**
 * Runs the shared preview pipeline off the main thread, with highlighting: a Markdown document,
 * or a text file shown as a code block (Step 014). The grammars load here only.
 */
type Request = { id: number; markdown: string } | { id: number; code: { text: string; language: string | undefined } };

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const tree = "code" in request ? highlightedCodeFileToHast(request.code.text, request.code.language) : highlightedMarkdownToHast(request.markdown);
    self.postMessage({ id: request.id, tree });
  } catch (err) {
    self.postMessage({ id: request.id, error: (err as Error).message });
  }
};
