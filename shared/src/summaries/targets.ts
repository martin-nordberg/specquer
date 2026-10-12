import { splitFrontmatter, toLf } from "../markdown/frontmatter.ts";
import { type Outline, type SummarizedSection, buildOutline, summarizedAt, summaryStopCount } from "../markdown/outline.ts";

/**
 * What the slider summarizes, worked out the same way on both sides: the server pre-fills and
 * looks up the summaries the preview asks for, and their cache keys only match if the text and
 * headings are exactly the same.
 */

/** The text summaries are made from: the file's body without front matter, with `\n` line endings. */
export function summaryBody(fileText: string): string {
  return toLf(splitFrontmatter(fileText).body);
}

/** A section some stop of the slider summarizes, with its text. */
export interface SummaryTarget extends SummarizedSection {
  text: string;
}

/**
 * Every section any stop summarizes: the union of `summarizedAt` over the stops, each once, the
 * deepest stop's sections first and the whole document last, so a long section's subsections
 * come before it.
 */
export function summaryTargets(body: string, outline: Outline = buildOutline(body)): SummaryTarget[] {
  const targets = new Map<string, SummaryTarget>();
  for (let stop = summaryStopCount(outline) - 2; stop >= 0; stop--) {
    for (const section of summarizedAt(outline, stop, body.length)) {
      if (!targets.has(section.path)) targets.set(section.path, { ...section, text: body.slice(section.range.from, section.range.to) });
    }
  }
  return [...targets.values()];
}
