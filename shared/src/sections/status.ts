import { parseSectionId } from "./ids.ts";
import { type TreeSection, sectionParents } from "./tree.ts";

/**
 * Section statuses: a section's own status is its anchor's `data-status`; without one (or with an
 * invalid one) it inherits its parent section's within the same prefix, and the first allowed
 * value of its prefix where the prefix changes or at the root. Each prefix has its list of
 * allowed values, from `.specquer/shared/<prefix>/prefix.config.yaml`, or the defaults.
 *
 * Shared so the server (problems, corrections on save) and the client (the badge's tooltip and the
 * section attributes dialog, from the text being edited) agree.
 */

/** The allowed statuses of a prefix without a usable `prefix.config.yaml`, in order. */
export const DEFAULT_STATUS_VALUES: readonly string[] = ["Draft", "Approved", "In Development", "Peer Review", "Testing", "Complete"];

/** The allowed value a status matches, ignoring case and surrounding spaces, or `undefined`; a blank status never matches. */
export function matchStatus(raw: string, allowed: readonly string[]): string | undefined {
  const wanted = raw.trim().toLowerCase();
  if (wanted === "") return undefined;
  return allowed.find((value) => value.toLowerCase() === wanted);
}

export interface StatusSection extends TreeSection {
  id: string | null;
  requestedPrefix?: string;
  anchor?: { status?: string };
}

export interface SectionStatus {
  /** The section's prefix: requested, else its ID's, else its parent's, else the folder's. */
  prefix: string | undefined;
  /** The anchor's `data-status` as written, or `null` when it has none. */
  own: string | null;
  /** The allowed value the own status matches; set only when it is valid. */
  canonical?: string;
  /** Whether the own status is absent or valid. */
  valid: boolean;
  /** What the section would inherit without a status of its own. */
  inherited: string;
  /** The status in effect, or `null` when its own is invalid. */
  effective: string | null;
}

export interface StatusOptions {
  /** A prefix's allowed values; `undefined` (no prefix known) gets the defaults. */
  allowed: (prefix: string | undefined) => readonly string[];
  /** The folder's default prefix, for a root section without one of its own. */
  folderPrefix?: string;
}

/** Each section's status, the root section first. */
export function sectionStatuses(sections: ReadonlyArray<StatusSection>, options: StatusOptions): SectionStatus[] {
  const parents = sectionParents(sections);
  const statuses: SectionStatus[] = [];
  // What each section passes on to its subsections: its valid own status, else what it inherited
  const passOn: string[] = [];
  sections.forEach((section, index) => {
    const parent = parents[index] ?? null;
    const idPrefix = section.id === null ? undefined : parseSectionId(section.id)?.prefix;
    const prefix = section.requestedPrefix ?? idPrefix ?? (parent === null ? options.folderPrefix : statuses[parent]!.prefix);
    const allowed = options.allowed(prefix);
    const first = allowed[0] ?? DEFAULT_STATUS_VALUES[0]!;
    const inherited = parent !== null && statuses[parent]!.prefix === prefix ? passOn[parent]! : first;
    const own = section.anchor?.status ?? null;
    const canonical = own === null ? undefined : matchStatus(own, allowed);
    const valid = own === null || canonical !== undefined;
    statuses.push({ prefix, own, ...(canonical === undefined ? {} : { canonical }), valid, inherited, effective: valid ? (canonical ?? inherited) : null });
    passOn.push(canonical ?? inherited);
  });
  return statuses;
}
