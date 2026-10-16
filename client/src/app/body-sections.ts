import { type BodyAnalysis, type Outline, analyzeBody, buildOutline } from "@specquer/shared/markdown";

/** A body's sections and heading outline, worked out together. */
export interface BodySections extends BodyAnalysis {
  outline: Outline;
}

let last: { body: string; result: BodySections } | null = null;

/**
 * The sections and heading outline of a body, parsed once per body however many ask (Step 016,
 * plan §4.4): the comment highlight, following the document, F8, the views' top position and the
 * Outline all read the same text, so a keystroke costs one parse.
 */
export function bodySections(body: string): BodySections {
  if (last?.body !== body) {
    const analysis = analyzeBody(body);
    last = { body, result: { ...analysis, outline: buildOutline(body, analysis.sections) } };
  }
  return last.result;
}

/** The outline path of the last heading starting at or before an offset of a body, or `null`. */
export function headingPathAt(body: string, offset: number): string | null {
  let path: string | null = null;
  const visit = (sections: Outline["sections"], prefix: string) =>
    sections.forEach((section, index) => {
      const here = prefix === "" ? String(index) : `${prefix}.${index}`;
      if (section.heading.from > offset) return;
      path = here;
      visit(section.children, here);
    });
  visit(bodySections(body).outline.sections, "");
  return path;
}
