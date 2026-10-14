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
