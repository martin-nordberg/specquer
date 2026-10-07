/**
 * Section IDs: a prefix, a dash and a sequence number of at least five digits, zero-padded
 * (`REQ-00023`). The prefix is an upper-case letter followed by 1 to 4 upper-case letters or
 * digits. Numbers past 99999 simply have more digits.
 */

export const SECTION_ID_PATTERN = /^([A-Z][A-Z0-9]{1,4})-([0-9]{5,})$/;

export const PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,4}$/;

/** The sequence number's minimum number of digits. */
export const SEQUENCE_DIGITS = 5;

export interface ParsedSectionId {
  prefix: string;
  sequence: number;
}

export function isSectionId(id: string): boolean {
  return SECTION_ID_PATTERN.test(id);
}

export function isPrefix(prefix: string): boolean {
  return PREFIX_PATTERN.test(prefix);
}

/** Splits a section ID into prefix and sequence number, or returns `null` if it isn't one. */
export function parseSectionId(id: string): ParsedSectionId | null {
  const match = SECTION_ID_PATTERN.exec(id);
  if (match === null) return null;
  return { prefix: match[1]!, sequence: Number.parseInt(match[2]!, 10) };
}

export function formatSectionId(prefix: string, sequence: number): string {
  if (!isPrefix(prefix)) throw new Error(`Invalid section prefix '${prefix}'`);
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error(`Invalid sequence number ${sequence}`);
  return `${prefix}-${String(sequence).padStart(SEQUENCE_DIGITS, "0")}`;
}
