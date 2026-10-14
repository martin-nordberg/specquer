import type { FoundSection } from "@specquer/shared/markdown";
import { parseSectionId, sectionParents } from "@specquer/shared/sections";

/**
 * The prefix each section of a document uses for a new ID, worked out top-down: the prefix an
 * `XYZ-?` placeholder asks for, else the prefix of the section's own ID if it is known, else its
 * parent section's (see `sectionParents`); the root section's own fallback is the folder's
 * default prefix.
 */
export function sectionPrefixes(
  sections: ReadonlyArray<Pick<FoundSection, "kind" | "id" | "requestedPrefix" | "depth">>,
  folderPrefix: string,
  knownPrefixes: ReadonlySet<string>,
): string[] {
  const parents = sectionParents(sections);
  const prefixes: string[] = [];
  sections.forEach((section, index) => {
    const idPrefix = section.id === null ? undefined : parseSectionId(section.id)?.prefix;
    const own = section.requestedPrefix ?? (idPrefix !== undefined && knownPrefixes.has(idPrefix) ? idPrefix : undefined);
    const parent = parents[index] ?? null;
    prefixes.push(own ?? (parent === null ? folderPrefix : prefixes[parent]!));
  });
  return prefixes;
}
