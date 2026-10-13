import { baseName } from "@specquer/shared/paths";
import { type OutlineSection, buildOutline, findSections } from "@specquer/shared/markdown";
import { simplifySectionText, summaryBody } from "@specquer/shared/summaries";

/**
 * The search index's units (Step 010, R4.3): a Markdown file split by its headings. Each heading
 * section's lead text (the text before its first subsection) is a unit, with the titles of the
 * headings above it; the text before the first heading is a unit too. Sectioned and
 * non-sectioned files are split alike.
 */

export interface SearchUnit {
  /** The unit's place in its file, from 0. */
  ord: number;
  /** The heading's outline path (`1.0.2`), or "" for the text before the first heading. */
  outlinePath: string;
  /**
   * The section ID in the heading's anchor, if any. Only a candidate: a non-sectioned file can
   * hold copied anchors, so a citation keeps it only when the section index holds it there.
   */
  anchorId?: string;
  title: string;
  /** The titles of the headings above, outermost first. */
  headings: string[];
  /** The simplified lead text. */
  text: string;
}

export function searchUnits(path: string, fileText: string): SearchUnit[] {
  const body = summaryBody(fileText);
  const outline = buildOutline(body);
  // The outline is built from these heading sections, in the same (document) order
  const ids = findSections(body)
    .filter((section) => section.kind === "heading")
    .map((section) => section.id ?? undefined);
  const units: SearchUnit[] = [];
  const preamble = simplifySectionText(body.slice(outline.preamble.from, outline.preamble.to));
  if (preamble !== "") units.push({ ord: 0, outlinePath: "", title: baseName(path), headings: [], text: preamble });
  let heading = 0;
  const visit = (sections: OutlineSection[], path: number[], headings: string[]) =>
    sections.forEach((section, index) => {
      const here = [...path, index];
      const anchorId = ids[heading++];
      units.push({
        ord: units.length,
        outlinePath: here.join("."),
        ...(anchorId === undefined ? {} : { anchorId }),
        title: section.title,
        headings,
        text: simplifySectionText(body.slice(section.lead.from, section.lead.to)),
      });
      visit(section.children, here, [...headings, section.title]);
    });
  visit(outline.sections, [], []);
  return units;
}
