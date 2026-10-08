import { isSectionId } from "../sections/ids.ts";

/**
 * The rules for summaries that client and server share: how a section's text is simplified
 * before it is summarized (and hashed for the cache), and how long a summary is.
 */

/** Sections with fewer words than this (after simplification) are shown as written. */
export const SHORT_SECTION_WORDS = 60;
export const MIN_SUMMARY_SENTENCES = 2;
export const MAX_SUMMARY_SENTENCES = 10;
/** About one summary sentence per this many words. */
export const WORDS_PER_SENTENCE = 150;
/** The most text one summary request may carry. */
export const MAX_SUMMARY_TEXT = 1_000_000;

/** An empty anchor with an `id` (and possibly a `data-uid`), as section anchors are written. */
const ANCHOR = /<a\s+id\s*=\s*"([^"]*)"(?:\s+data-uid\s*=\s*"[^"]*")?\s*><\/a>[ \t]*/gi;

/**
 * Simplifies a section's text: LF line endings, no trailing whitespace on lines, one blank line
 * at most between blocks, no section anchors (placeholders included), and no leading or trailing
 * whitespace. Editor settings and anchor metadata then don't change cache keys.
 */
export function simplifySectionText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(ANCHOR, (match, id: string) => (id === "" || isSectionId(id) ? "" : match))
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

/** Whether a simplified section is short enough to be shown as written. */
export function isShortSection(simplified: string): boolean {
  return wordCount(simplified) < SHORT_SECTION_WORDS;
}

/** The number of sentences a summary of `words` words has: about one per 150 words, 2 to 10. */
export function targetSentences(words: number): number {
  return Math.min(MAX_SUMMARY_SENTENCES, Math.max(MIN_SUMMARY_SENTENCES, Math.round(words / WORDS_PER_SENTENCE)));
}
