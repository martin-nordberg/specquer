/**
 * Section UIDs: the CUID2 in a section anchor's `data-uid`, the section's permanent identity. The
 * root anchor's UID is also the document ID. New UIDs are `UID_LENGTH` characters long; longer
 * ones, written before Step 003, stay valid.
 */

export const UID_PATTERN = /^[a-z][a-z0-9]{1,63}$/;

/** The length of new UIDs. */
export const UID_LENGTH = 12;

export function isUid(value: string): boolean {
  return UID_PATTERN.test(value);
}
