import type { SectionRenumberReason } from "@specquer/shared/api";
import { parseSectionId } from "@specquer/shared/sections";
import { type DocumentEntry, type PrefixData, type SectionData, type SectionEntry, emptyPrefixData } from "./data.ts";

/**
 * Reconciliation: from the data files and the sections found in the documents, the data files
 * as they should be, the changes each document's anchors need, and the duplicates waiting for
 * the user. Pure; the caller supplies new UIDs (CUID2s).
 *
 * A section's identity is its UID (`data-uid` in its anchor); its ID is its name. The root
 * section's UID is the document ID. "Recorded" means the entry in the data files.
 *
 * Documents:
 * - A document without a document ID gets the one recorded for its path, if no other file holds
 *   it, or a new one.
 * - A document ID held by several files: the file at the recorded path keeps it, or the first by
 *   path; the others are copies and get new IDs as above.
 * - A document found at another path than recorded was moved: the path is updated.
 * - Entries for document IDs no file holds (deleted, or no longer matching the configuration)
 *   are removed; their sections are retired.
 *
 * Sections, in this order:
 * - An ID whose prefix isn't known is renumbered.
 * - A known UID with another ID (an edited ID): the recorded ID is put back, unless another
 *   section holds it.
 * - A retired ID with its retired UID is a restore; with no UID or another UID it is reused and
 *   renumbered.
 * - An ID used more than once: the occurrence in the document recorded for it (preferably with
 *   the recorded UID) keeps it, or else the first by path. A copy within one document, or in a
 *   copied document, is renumbered; other duplicates (the same UID in several documents) and
 *   collisions (different UIDs) wait for the user, who can ask for one occurrence to be
 *   renumbered.
 * - The same UID with different IDs (a copied UID): the occurrence with the recorded ID keeps
 *   it; the others get new UIDs. A section without a UID takes the one recorded for its ID.
 * - A section found in another document than recorded was moved: its entry follows it.
 * - Entries for UIDs no document holds are retired; a retired UID found again comes back.
 * - `lastSequence` becomes the highest number known for the prefix, so numbers are never reused.
 *
 * A frozen document (one with merge conflict markers) gets no fixes: its sections count as
 * present, so they are neither retired nor reused, but take no part in settling duplicates.
 */

export interface ScannedSection {
  /** The section ID, or `null` for no anchor or a placeholder. */
  id: string | null;
  /** The anchor's UID, or `null` for none. */
  uid: string | null;
}

export interface ScannedDocument {
  path: string;
  /** The found sections, the root section first; its UID is the document ID. */
  sections: readonly ScannedSection[];
  /** Holds merge conflict markers: counted, but never changed. */
  frozen?: boolean;
}

/** Why a section needs a new number. */
export type RenumberReason = SectionRenumberReason;

export interface DocumentFix {
  /** The document ID, which is the root anchor's UID. */
  documentId: string;
  /** Sections that need a new number, by index, with the reason. */
  renumber: Map<number, RenumberReason>;
  /** Sections whose recorded ID is put back (an edited ID), by index. */
  restore: Map<number, string>;
  /** New or corrected UIDs, by index; every section without a UID gets one. */
  uids: Map<number, string>;
  /** Sections whose UID is replaced because another section holds it. */
  uidReplaced: Set<number>;
}

export interface DuplicateOccurrence {
  path: string;
  index: number;
  /** Whether this occurrence keeps the ID; the others wait to be renumbered. */
  keeps: boolean;
}

export interface Duplicate {
  id: string;
  /** `duplicate`: copies of one section (one UID) in several documents; `collision`: different sections. */
  kind: "duplicate" | "collision";
  occurrences: DuplicateOccurrence[];
}

/** A duplicate occurrence the user asked to renumber. */
export interface RenumberRequest {
  path: string;
  index: number;
}

export interface ReconcileResult {
  data: SectionData;
  /** By path, for every scanned document. */
  fixes: Map<string, DocumentFix>;
  /** Duplicates and collisions waiting for the user. */
  duplicates: Duplicate[];
}

interface Occurrence {
  doc: ScannedDocument;
  fix: DocumentFix;
  index: number;
  documentId: string;
  /** The ID, after an edited ID is put back. */
  id: string;
  uid: string | null;
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function reconcile(
  data: SectionData,
  scanned: readonly ScannedDocument[],
  knownPrefixes: ReadonlySet<string>,
  newUid: () => string,
  requests: readonly RenumberRequest[] = [],
): ReconcileResult {
  const documents = [...scanned].sort(byPath);
  const documentIdOf = (doc: ScannedDocument) => doc.sections[0]?.uid ?? null;

  // Documents: settle each file's document ID
  const holders = new Map<string, ScannedDocument[]>();
  for (const doc of documents) {
    const documentId = documentIdOf(doc);
    if (documentId === null) continue;
    const list = holders.get(documentId) ?? [];
    list.push(doc);
    holders.set(documentId, list);
  }
  const assigned = new Map<ScannedDocument, string>();
  const taken = new Set<string>();
  const copies = new Set<ScannedDocument>();
  for (const [documentId, files] of holders) {
    const recorded = data.documents.get(documentId)?.path;
    const keeper = files.find((doc) => doc.path === recorded) ?? files[0]!;
    assigned.set(keeper, documentId);
    taken.add(documentId);
    for (const doc of files) if (doc !== keeper) copies.add(doc);
  }
  const recordedByPath = new Map<string, string>();
  for (const [documentId, entry] of data.documents) if (!recordedByPath.has(entry.path)) recordedByPath.set(entry.path, documentId);
  for (const doc of documents) {
    if (assigned.has(doc)) continue;
    const recorded = recordedByPath.get(doc.path);
    const documentId = recorded !== undefined && !taken.has(recorded) && !holders.has(recorded) ? recorded : newUid();
    assigned.set(doc, documentId);
    taken.add(documentId);
  }

  const newDocuments = new Map<string, DocumentEntry>();
  const pathById = new Map<string, string>([...assigned].map(([doc, id]) => [id, doc.path]));
  for (const documentId of data.documents.keys()) {
    const path = pathById.get(documentId);
    if (path !== undefined) newDocuments.set(documentId, { path });
  }
  for (const doc of documents) {
    const documentId = assigned.get(doc)!;
    if (!newDocuments.has(documentId)) newDocuments.set(documentId, { path: doc.path });
  }

  // What the data files record
  const recordedByUid = new Map<string, SectionEntry>();
  const recordedById = new Map<string, Array<[uid: string, entry: SectionEntry]>>();
  const retiredUidsById = new Map<string, Set<string>>();
  for (const prefixData of data.prefixes.values()) {
    for (const [uid, entry] of prefixData.sections) {
      if (!recordedByUid.has(uid)) recordedByUid.set(uid, entry);
      const list = recordedById.get(entry.id) ?? [];
      list.push([uid, entry]);
      recordedById.set(entry.id, list);
    }
    for (const [uid, entry] of prefixData.retired) {
      const set = retiredUidsById.get(entry.id) ?? new Set();
      set.add(uid);
      retiredUidsById.set(entry.id, set);
    }
  }

  // Occurrences of section IDs
  const fixes = new Map<string, DocumentFix>();
  const occurrences: Occurrence[] = [];
  const frozen: Occurrence[] = [];
  const present = new Set<string>();
  const highest = new Map<string, number>();
  for (const doc of documents) {
    const documentId = assigned.get(doc)!;
    const fix: DocumentFix = { documentId, renumber: new Map(), restore: new Map(), uids: new Map(), uidReplaced: new Set() };
    fixes.set(doc.path, fix);
    doc.sections.forEach((section, index) => {
      const uid = index === 0 ? documentId : section.uid;
      if (section.uid !== null) present.add(section.uid);
      if (index === 0 && section.uid !== documentId && !doc.frozen) fix.uids.set(0, documentId);
      const parsed = section.id === null ? null : parseSectionId(section.id);
      const known = parsed !== null && knownPrefixes.has(parsed.prefix);
      if (known) highest.set(parsed.prefix, Math.max(highest.get(parsed.prefix) ?? 0, parsed.sequence));
      if (doc.frozen) {
        if (known) frozen.push({ doc, fix, index, documentId, id: section.id!, uid });
        return;
      }
      if (section.id === null || !known) {
        if (section.id !== null) fix.renumber.set(index, "unknown-prefix");
        if (index !== 0) fix.uids.set(index, newUid());
        return;
      }
      occurrences.push({ doc, fix, index, documentId, id: section.id, uid });
    });
  }
  const renumber = (o: Occurrence, reason: RenumberReason, keepUid = false) => {
    o.fix.renumber.set(o.index, reason);
    o.fix.restore.delete(o.index);
    if (o.index !== 0 && !keepUid) o.fix.uids.set(o.index, newUid());
  };

  // Edited IDs: a known UID found only with other IDs gets its recorded ID back
  const byUid = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    if (o.uid === null) continue;
    const list = byUid.get(o.uid) ?? [];
    list.push(o);
    byUid.set(o.uid, list);
  }
  const ids = new Set(occurrences.map((o) => o.id));
  for (const [uid, list] of byUid) {
    const recorded = recordedByUid.get(uid);
    if (recorded === undefined || list.some((o) => o.id === recorded.id) || ids.has(recorded.id)) continue;
    const o = list.find((candidate) => candidate.documentId === recorded.documentId) ?? list[0]!;
    o.fix.restore.set(o.index, recorded.id);
    o.id = recorded.id;
    ids.add(recorded.id);
  }

  // Retired IDs: back with their UID is a restore; anything else reuses a retired number
  const live: Occurrence[] = [];
  for (const o of occurrences) {
    const retired = recordedById.has(o.id) ? undefined : retiredUidsById.get(o.id);
    if (retired !== undefined && (o.uid === null || !retired.has(o.uid))) renumber(o, "reused");
    else live.push(o);
  }

  // Duplicates
  const byId = new Map<string, Occurrence[]>();
  for (const o of live) {
    const list = byId.get(o.id) ?? [];
    list.push(o);
    byId.set(o.id, list);
  }
  const requested = (o: Occurrence) => requests.some((r) => r.path === o.doc.path && r.index === o.index);
  const pending = new Set<Occurrence>();
  const duplicates: Duplicate[] = [];
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    const entries = recordedById.get(id) ?? [];
    const candidates = list.some((o) => !requested(o)) ? list.filter((o) => !requested(o)) : list;
    // The earliest entry that matches an occurrence decides
    const matching = (matches: (uid: string, entry: SectionEntry, o: Occurrence) => boolean) => {
      for (const [uid, entry] of entries) {
        const found = candidates.find((o) => matches(uid, entry, o));
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const keeper =
      matching((uid, entry, o) => entry.documentId === o.documentId && uid === o.uid) ??
      matching((_, entry, o) => entry.documentId === o.documentId) ??
      matching((uid, _, o) => uid === o.uid) ??
      candidates[0]!;
    const waiting: Occurrence[] = [];
    let collision = false;
    for (const o of list) {
      if (o === keeper) continue;
      const sameSection = o.uid === null || keeper.uid === null || o.uid === keeper.uid;
      if (copies.has(o.doc) || (sameSection && o.doc === keeper.doc)) renumber(o, "copy");
      else if (requested(o)) renumber(o, sameSection ? "duplicate" : "collision", !sameSection);
      else {
        waiting.push(o);
        pending.add(o);
        if (!sameSection) collision = true;
      }
    }
    if (waiting.length > 0) {
      duplicates.push({
        id,
        kind: collision ? "collision" : "duplicate",
        occurrences: [keeper, ...waiting].map((o) => ({ path: o.doc.path, index: o.index, keeps: o === keeper })),
      });
    }
  }

  // UIDs: the occurrences keeping their IDs claim their UIDs, those matching the record first
  const kept = live.filter((o) => !pending.has(o) && !o.fix.renumber.has(o.index));
  const claimed = new Set<string>();
  const finalUid = new Map<Occurrence, string>();
  const first = kept.filter((o) => o.index === 0 || (o.uid !== null && recordedByUid.get(o.uid)?.id === o.id));
  for (const o of first) {
    if (o.uid === null || claimed.has(o.uid)) continue;
    claimed.add(o.uid);
    finalUid.set(o, o.uid);
  }
  for (const o of kept) {
    if (finalUid.has(o)) continue;
    let uid: string;
    if (o.uid !== null && !claimed.has(o.uid)) uid = o.uid;
    else if (o.uid !== null) {
      uid = newUid();
      o.fix.uidReplaced.add(o.index);
    } else {
      const entries = recordedById.get(o.id) ?? [];
      const usable = ([candidate]: [string, SectionEntry]) => !claimed.has(candidate) && !present.has(candidate);
      const recorded = entries.find((entry) => entry[1].documentId === o.documentId && usable(entry)) ?? entries.find(usable);
      uid = recorded?.[0] ?? newUid();
    }
    if (uid !== o.uid) o.fix.uids.set(o.index, uid);
    claimed.add(uid);
    finalUid.set(o, uid);
  }

  // The new data: entries for the kept sections, existing ones in order, then new ones
  const prefixes = new Map<string, PrefixData>();
  const prefixOf = (id: string) => parseSectionId(id)!.prefix;
  const ensure = (prefix: string) => {
    let prefixData = prefixes.get(prefix);
    if (prefixData === undefined) {
      const old = data.prefixes.get(prefix);
      let lastSequence = Math.max(old?.lastSequence ?? 0, highest.get(prefix) ?? 0);
      for (const entry of [...(old?.sections.values() ?? []), ...(old?.retired.values() ?? [])]) {
        lastSequence = Math.max(lastSequence, parseSectionId(entry.id)?.sequence ?? 0);
      }
      prefixData = emptyPrefixData(lastSequence);
      prefixes.set(prefix, prefixData);
    }
    return prefixData;
  };
  for (const prefix of data.prefixes.keys()) ensure(prefix);
  const entries = new Map<string, SectionEntry>();
  for (const o of [...kept, ...frozen]) {
    const uid = finalUid.get(o) ?? o.uid;
    if (uid !== null && !entries.has(uid)) entries.set(uid, { id: o.id, documentId: o.documentId });
  }
  for (const prefixData of data.prefixes.values()) {
    for (const uid of prefixData.sections.keys()) {
      const entry = entries.get(uid);
      if (entry !== undefined) ensure(prefixOf(entry.id)).sections.set(uid, entry);
    }
  }
  for (const [uid, entry] of entries) {
    const prefixData = ensure(prefixOf(entry.id));
    if (!prefixData.sections.has(uid)) prefixData.sections.set(uid, entry);
  }

  // Retired: kept unless back; entries no document holds any more join them
  for (const [prefix, prefixData] of data.prefixes) {
    for (const [uid, entry] of prefixData.retired) if (!entries.has(uid)) ensure(prefix).retired.set(uid, entry);
  }
  for (const [prefix, prefixData] of data.prefixes) {
    for (const [uid, entry] of prefixData.sections) {
      if (entries.has(uid) || present.has(uid)) continue;
      ensure(prefix).retired.set(uid, { id: entry.id });
    }
  }

  return { data: { documents: newDocuments, prefixes }, fixes, duplicates };
}
