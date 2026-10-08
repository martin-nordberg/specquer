import { type Range, analyzeBody } from "./sections.ts";

/**
 * The heading outline of a Markdown body, for summaries: each top-level heading's section with
 * the source range it covers. Built from the same syntax tree as `analyzeBody`, so headings in
 * block quotes and lists don't count. Offsets are offsets into the body (`\n` line endings).
 */

export interface OutlineSection {
  /** The heading level, 1 to 6. */
  depth: number;
  title: string;
  /** The heading, from its section anchor on the line before it, if any, to the heading's end. */
  heading: Range;
  /** The whole section: from `heading.from` to the next heading of the same or a higher level. */
  range: Range;
  /** The text under the heading before its first subsection. */
  lead: Range;
  children: OutlineSection[];
}

export interface Outline {
  /** The text before the first heading. */
  preamble: Range;
  sections: OutlineSection[];
  /** The heading levels used, ascending. */
  levels: number[];
}

/** Builds the outline of a body. */
export function buildOutline(body: string): Outline {
  const headings = analyzeBody(body).sections.filter((section) => section.kind === "heading");
  const end = body.length;
  const flat = headings.map((section) => {
    const anchorFrom = section.anchor?.from ?? section.insertAt;
    const from = Math.min(anchorFrom, section.insertAt);
    return { depth: section.depth ?? 1, title: section.title, from, headingEnd: headingEnd(body, section.insertAt) };
  });

  const sections: OutlineSection[] = [];
  const stack: OutlineSection[] = [];
  flat.forEach((heading, index) => {
    // The section runs to the next heading of the same or a higher level
    let to = end;
    for (let next = index + 1; next < flat.length; next++) {
      if (flat[next]!.depth <= heading.depth) {
        to = flat[next]!.from;
        break;
      }
    }
    const firstChild = flat[index + 1] !== undefined && flat[index + 1]!.depth > heading.depth ? flat[index + 1]!.from : to;
    const section: OutlineSection = {
      depth: heading.depth,
      title: heading.title,
      heading: { from: heading.from, to: heading.headingEnd },
      range: { from: heading.from, to },
      lead: { from: Math.min(heading.headingEnd, firstChild), to: firstChild },
      children: [],
    };
    while (stack.length > 0 && stack.at(-1)!.depth >= section.depth) stack.pop();
    (stack.at(-1)?.children ?? sections).push(section);
    stack.push(section);
  });

  return {
    preamble: { from: 0, to: flat[0]?.from ?? end },
    sections,
    levels: [...new Set(flat.map((heading) => heading.depth))].sort((a, b) => a - b),
  };
}

/**
 * Where a heading ends: the end of its line for an ATX heading, the end of its underline for a
 * setext one. `insertAt` is the heading's line start (ATX) or its first character (setext).
 */
function headingEnd(body: string, insertAt: number): number {
  const lineEnd = (from: number) => {
    const at = body.indexOf("\n", from);
    return at === -1 ? body.length : at;
  };
  const first = lineEnd(insertAt);
  if (/^ {0,3}#/.test(body.slice(insertAt, first))) return first;
  // Setext: the heading's text may span lines; it ends with the `===` or `---` underline
  let at = first;
  while (at < body.length) {
    const next = lineEnd(at + 1);
    if (/^ {0,3}(=+|-+)[ \t]*$/.test(body.slice(at + 1, next))) return next;
    at = next;
  }
  return first;
}

/** The number of slider stops: one per heading level plus the full text and the whole document; none without headings. */
export function summaryStopCount(outline: Outline): number {
  return outline.levels.length === 0 ? 0 : outline.levels.length + 2;
}

/** A section a stop replaces with a summary. */
export interface SummarizedSection {
  /** Section indexes from the top (`1.0.2`), or "" for the whole document. */
  path: string;
  /** The whole document (stop 0), whose summary replaces its headings too. */
  document: boolean;
  /** The section's heading, kept above its summary; `null` for the whole document. */
  heading: Range | null;
  range: Range;
  /** The titles of the headings above the section, outermost first. */
  headings: string[];
}

/**
 * The sections a stop summarizes. Stop `levels.length + 1` is the full text; stop `k` (1 to
 * `levels.length`) summarizes each section at level `levels[k - 1]` or deeper that isn't inside
 * one already summarized; stop 0 summarizes the whole document.
 */
export function summarizedAt(outline: Outline, stop: number, bodyLength: number): SummarizedSection[] {
  const count = summaryStopCount(outline);
  if (count === 0 || stop >= count - 1) return [];
  if (stop <= 0) return [{ path: "", document: true, heading: null, range: { from: 0, to: bodyLength }, headings: [] }];
  const depth = outline.levels[stop - 1]!;
  const found: SummarizedSection[] = [];
  const visit = (sections: OutlineSection[], path: number[], headings: string[]) => {
    sections.forEach((section, index) => {
      const here = [...path, index];
      if (section.depth >= depth) {
        found.push({ path: here.join("."), document: false, heading: section.heading, range: section.range, headings });
      } else visit(section.children, here, [...headings, section.title]);
    });
  };
  visit(outline.sections, [], []);
  return found;
}

/** Every section's heading range with its outline path, in document order. */
export function outlineHeadings(outline: Outline): Array<{ heading: Range; path: string }> {
  const found: Array<{ heading: Range; path: string }> = [];
  const visit = (sections: OutlineSection[], path: number[]) =>
    sections.forEach((section, index) => {
      found.push({ heading: section.heading, path: [...path, index].join(".") });
      visit(section.children, [...path, index]);
    });
  visit(outline.sections, []);
  return found;
}

/** The section at an outline path, or `undefined`. */
export function sectionAtPath(outline: Outline, path: string): OutlineSection | undefined {
  if (path === "") return undefined;
  let sections = outline.sections;
  let found: OutlineSection | undefined;
  for (const part of path.split(".")) {
    found = sections[Number(part)];
    if (found === undefined) return undefined;
    sections = found.children;
  }
  return found;
}

/** The stop's accessible name. */
export function summaryStopName(outline: Outline, stop: number): string {
  const count = summaryStopCount(outline);
  if (stop >= count - 1) return "Full text";
  if (stop <= 0) return "Summarize document";
  return `Summarize level ${outline.levels[stop - 1]} sections`;
}
