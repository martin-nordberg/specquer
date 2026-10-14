import type { SectionStatusLists } from "@specquer/shared/api";
import { type FoundSection, analyzeBody } from "@specquer/shared/markdown";
import { DEFAULT_STATUS_VALUES, type SectionStatus, matchStatus, parseSectionId, sectionStatuses } from "@specquer/shared/sections";

/**
 * Section statuses in the client, worked out from the text being edited (not the saved file), so
 * the badges and the section attributes dialog follow every change at once. The allowed values
 * come from the server (`GET /api/sections/statuses`).
 */

/** A section with its status. */
export interface SectionWithStatus {
  section: FoundSection;
  status: SectionStatus;
}

/** What a badge shows of a status. */
export interface BadgeStatus {
  /** The status in effect, or the invalid one as written. */
  text: string;
  inherited: boolean;
  invalid: boolean;
}

/** A prefix's allowed values, from the lists. */
export function allowedStatuses(lists: SectionStatusLists, prefix: string | undefined): readonly string[] {
  return (prefix === undefined ? undefined : lists.statusValues[prefix]) ?? DEFAULT_STATUS_VALUES;
}

/** Every section of a body with its status; empty when the file isn't sectioned. */
export function statusesOfBody(body: string, lists: SectionStatusLists): SectionWithStatus[] {
  if (!lists.sectioned) return [];
  const sections = analyzeBody(body).sections;
  const statuses = sectionStatuses(sections, {
    allowed: (prefix) => allowedStatuses(lists, prefix),
    ...(lists.folderPrefix === null ? {} : { folderPrefix: lists.folderPrefix }),
  });
  return sections.map((section, index) => ({ section, status: statuses[index]! }));
}

/** The section with this ID and UID (any UID when `uid` is undefined or `null`). */
export function findSection(entries: readonly SectionWithStatus[], id: string, uid?: string | null): SectionWithStatus | undefined {
  return entries.find((entry) => entry.section.id === id && (uid === undefined || uid === null || entry.section.uid === uid));
}

export function badgeStatus(status: SectionStatus): BadgeStatus {
  if (!status.valid) return { text: status.own ?? "", inherited: false, invalid: true };
  return { text: status.effective ?? status.inherited, inherited: status.own === null, invalid: false };
}

/** "Peer Review", "Draft (inherited)", "Revieww (not allowed)". */
export function statusLabel(status: BadgeStatus): string {
  if (status.invalid) return `${status.text === "" ? "(blank)" : status.text} (not allowed)`;
  return status.inherited ? `${status.text} (inherited)` : status.text;
}

/** Whether an anchor's own status, as written, isn't allowed for the prefix of its section ID. */
export function hasInvalidOwnStatus(id: string, own: string | undefined, lists: SectionStatusLists): boolean {
  if (own === undefined || !lists.sectioned) return false;
  return matchStatus(own, allowedStatuses(lists, parseSectionId(id)?.prefix)) === undefined;
}
