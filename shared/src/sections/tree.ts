/**
 * The section tree of a document, from its sections in order (the root section first): the
 * parent of a heading is the nearest heading above it at a higher level, of a list item the
 * heading holding the list, and of both the root section when there is none.
 */

export interface TreeSection {
  kind: "root" | "heading" | "item";
  /** The heading level, for headings. */
  depth?: number;
}

/** Each section's parent, by index; `null` for the root section. */
export function sectionParents(sections: ReadonlyArray<TreeSection>): Array<number | null> {
  const parents: Array<number | null> = [];
  const headings: Array<{ depth: number; index: number }> = [];
  sections.forEach((section, index) => {
    if (index === 0) {
      parents.push(null);
      return;
    }
    if (section.kind === "heading") {
      while (headings.length > 0 && headings.at(-1)!.depth >= (section.depth ?? 1)) headings.pop();
    }
    parents.push(headings.at(-1)?.index ?? 0);
    if (section.kind === "heading") headings.push({ depth: section.depth ?? 1, index });
  });
  return parents;
}

/** What a section's extent is worked out from: where it starts, and a list item's own range. */
export interface ExtentSection extends TreeSection {
  /** Where the section starts: its anchor, or where its anchor would go. */
  start: number;
  /** A list item's source range. */
  range?: { from: number; to: number };
}

/**
 * Each section's extent in the body (Step 012, R6.1): from its start to the start of the first
 * later section that isn't inside it, or the end of the body, so subsections are included. A list
 * item's extent is the item, nested items included. Sections are in document order, so a section's descendants
 * follow it without a gap.
 */
export function sectionExtents(sections: ReadonlyArray<ExtentSection>, bodyLength: number): Array<{ from: number; to: number }> {
  const parents = sectionParents(sections);
  return sections.map((section, index) => {
    const from = index === 0 ? 0 : section.start;
    if (section.kind === "item" && section.range !== undefined) return { from: section.range.from, to: section.range.to };
    let next = index + 1;
    while (next < sections.length && isInside(parents, next, index)) next++;
    return { from, to: next < sections.length ? Math.max(from, sections[next]!.start) : bodyLength };
  });
}

/** Whether section `index` is inside section `ancestor` (not counting itself). */
function isInside(parents: ReadonlyArray<number | null>, index: number, ancestor: number): boolean {
  for (let at = parents[index] ?? null; at !== null; at = parents[at] ?? null) if (at === ancestor) return true;
  return false;
}

/** The indexes of a section's subsections at every depth, in order. */
export function descendantsOf(parents: ReadonlyArray<number | null>, index: number): number[] {
  const result: number[] = [];
  for (let next = index + 1; next < parents.length && isInside(parents, next, index); next++) result.push(next);
  return result;
}
