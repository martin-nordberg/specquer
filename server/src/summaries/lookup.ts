import { sectionInput } from "@specquer/agent";
import { ApiError, type SectionSummaryLookup } from "@specquer/shared/api";
import { type FoundSection, type OutlineSection, buildOutline } from "@specquer/shared/markdown";
import { isShortSection, simplifySectionText, summaryTargets } from "@specquer/shared/summaries";
import type { FoundSummary } from "./cache.ts";

/**
 * A section's summary by section ID (Step 005, §4.4): from the cache only, never from a model
 * call (D5). The section's text and headings are worked out as the preview's are
 * (`summaryTargets`), so the summary the slider made is the one found.
 */

export interface LookupSources {
  /** The section's document, its body, and the section found in it. */
  find(id: string): Promise<{ path: string; body: string; section: FoundSection } | undefined>;
  /** The best cached summary of a section's simplified text with its sentence count. */
  best(text: string, sentences: number): Promise<FoundSummary | undefined>;
}

/** The outline path (`1.0.2`) of the section whose heading holds `offset`. */
function headingPath(sections: OutlineSection[], offset: number, path: number[] = []): string | undefined {
  for (const [index, section] of sections.entries()) {
    const here = [...path, index];
    if (offset >= section.heading.from && offset < section.heading.to) return here.join(".");
    if (offset >= section.range.from && offset < section.range.to) return headingPath(section.children, offset, here);
  }
  return undefined;
}

export async function lookupSection(id: string, sources: LookupSources): Promise<SectionSummaryLookup> {
  const found = await sources.find(id);
  if (found === undefined) throw new ApiError(404, "not_found", `No section has the ID ${id}.`);
  const { path, body, section } = found;
  if (section.kind === "item") {
    const range = section.range ?? { from: section.insertAt, to: body.indexOf("\n", section.insertAt) };
    return { kind: "text", text: simplifySectionText(body.slice(range.from, range.to === -1 ? body.length : range.to)) };
  }
  const outline = buildOutline(body);
  const outlinePath = section.kind === "root" ? "" : headingPath(outline.sections, section.anchor?.from ?? section.insertAt);
  if (outlinePath === undefined) return { kind: "none" };
  const target = summaryTargets(body, outline).find((candidate) => candidate.path === outlinePath);
  // A document without headings has no slider; its text is summarized as a whole
  const input = target === undefined ? sectionInput(body, path, []) : sectionInput(target.text, path, target.headings);
  if (isShortSection(input.text)) return { kind: "text", text: input.text };
  const summary = await sources.best(input.text, input.sentences);
  return summary === undefined ? { kind: "none" } : { kind: "summary", ...summary };
}
