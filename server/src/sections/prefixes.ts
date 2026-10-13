import type { FoundSection } from "@specquer/shared/markdown";
import { parseSectionId } from "@specquer/shared/sections";

/**
 * The prefix each section of a document uses for a new ID, worked out top-down: the prefix an
 * `XYZ-?` placeholder asks for, else the prefix of the section's own ID if it is known, else its
 * parent section's. The parent of a heading is the nearest heading above it at a higher level,
 * of a list item the heading holding the list, and of both the root section when there is none;
 * the root section's own fallback is the folder's default prefix.
 */
export function sectionPrefixes(
  sections: ReadonlyArray<Pick<FoundSection, "kind" | "id" | "requestedPrefix" | "depth">>,
  folderPrefix: string,
  knownPrefixes: ReadonlySet<string>,
): string[] {
  const prefixes: string[] = [];
  const headings: Array<{ depth: number; prefix: string }> = [];
  sections.forEach((section, index) => {
    const idPrefix = section.id === null ? undefined : parseSectionId(section.id)?.prefix;
    const own = section.requestedPrefix ?? (idPrefix !== undefined && knownPrefixes.has(idPrefix) ? idPrefix : undefined);
    let parent: string;
    if (index === 0) parent = folderPrefix;
    else {
      if (section.kind === "heading") {
        while (headings.length > 0 && headings.at(-1)!.depth >= (section.depth ?? 1)) headings.pop();
      }
      parent = headings.at(-1)?.prefix ?? prefixes[0]!;
    }
    const prefix = own ?? parent;
    prefixes.push(prefix);
    if (section.kind === "heading") headings.push({ depth: section.depth ?? 1, prefix });
  });
  return prefixes;
}
