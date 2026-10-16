/// <reference lib="webworker" />
import { highlightedCodeFileToHast, highlightedMarkdownToHast } from "@specquer/shared/highlight";
import { type OutlineStatusLists, outlineOf } from "@specquer/shared/markdown";

/**
 * Runs the shared preview pipeline off the main thread, with highlighting: a Markdown document,
 * or a text file shown as a code block (Step 014). The grammars load here only. It also works out
 * the Outline's tree (Step 016), whose parse is too slow for the main thread in large documents.
 */
type Request =
  | { id: number; markdown: string }
  | { id: number; code: { text: string; language: string | undefined } }
  | { id: number; outline: { body: string; sectioned: boolean; lists?: OutlineStatusLists } };

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if ("outline" in request) {
      const { body, ...options } = request.outline;
      self.postMessage({ id: request.id, outline: outlineOf(body, options) });
      return;
    }
    const tree = "code" in request ? highlightedCodeFileToHast(request.code.text, request.code.language) : highlightedMarkdownToHast(request.markdown);
    self.postMessage({ id: request.id, tree });
  } catch (err) {
    self.postMessage({ id: request.id, error: (err as Error).message });
  }
};
