import { type Completion, type CompletionContext, type CompletionResult, autocompletion } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import type { SectionSearchResult } from "@specquer/shared/api";
import { relativePath } from "@specquer/shared/paths";
import { resolveDocumentLink } from "@/components/Preview";

/** The most completions offered at a time. */
export const COMPLETION_LIMIT = 50;

export type SectionSearch = (query: string, path?: string) => Promise<SectionSearchResult[]>;

/** A link target being typed: `](path#ID`, with the path and ID both possibly empty. */
const LINK_TARGET = /\]\(([^()\s#]*)#([A-Za-z0-9-]*)$/;

/**
 * Completes section IDs in Markdown link targets: typing `#` after `](` offers the sections of
 * all documents (inserting the path to another document, relative to the open file), typing it
 * after `](path` offers that document's sections. Each option shows its heading text and document.
 */
export function sectionCompletionSource(search: SectionSearch, currentFile: () => string) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\]\([^()\s#]*#[A-Za-z0-9-]*/);
    if (match === null) return null;
    const parts = LINK_TARGET.exec(match.text);
    if (parts === null) return null;
    const [, pathPart = "", idPart = ""] = parts;
    const file = currentFile();
    const target = pathPart === "" ? undefined : resolveDocumentLink(pathPart, file)?.path;
    if (pathPart !== "" && target === undefined) return null;
    let results: SectionSearchResult[];
    try {
      results = await search(idPart, target);
    } catch {
      return null;
    }
    if (context.aborted) return null;
    const options: Completion[] = results.map((result) => ({
      label: result.id,
      detail: result.title,
      info: result.path,
      type: "keyword",
      apply: `${pathPart === "" ? relativePath(file, result.path) : pathPart}#${result.id}`,
    }));
    return { from: match.from + 2, options, filter: false };
  };
}

export function sectionCompletion(search: SectionSearch, currentFile: () => string): Extension {
  // One source for the editor's life: completion restarts when a source's identity changes
  const data = [{ autocomplete: sectionCompletionSource(search, currentFile) }];
  return [autocompletion(), EditorState.languageData.of(() => data)];
}
