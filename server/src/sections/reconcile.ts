import { parseSectionId } from "@specquer/shared/sections";
import type { DocumentEntry, PrefixData, SectionData, SectionEntry } from "./data.ts";

/**
 * Reconciliation: from the data files and the sections found in the documents, the data files
 * as they should be and, for each document, the changes its anchors need. Pure; the caller
 * supplies new CUID2s.
 *
 * Documents:
 * - A document without a document ID gets the one recorded for its path, if no other file holds
 *   it, or a new one.
 * - A document ID held by several files (a copy): the file at the recorded path keeps it, or the
 *   first by path; the others get new IDs as above.
 * - A document found at another path than recorded was moved: the path is updated.
 * - Entries for document IDs no file holds (deleted, or no longer matching the configuration)
 *   are removed, with their sections.
 *
 * Sections:
 * - An ID whose prefix isn't known is renumbered.
 * - An ID used more than once: the occurrence in the document `sections.yaml` records for it
 *   keeps it (the earliest such entry), or else the first by path; within a document, the first
 *   occurrence. The others are renumbered.
 * - A section found in another document than recorded was moved: it keeps its entry (and CUID2)
 *   and the entry's document ID is updated.
 * - IDs found in documents but not recorded get entries, appended; entries for IDs no document
 *   holds are removed.
 * - `lastSequence` becomes the highest number known for the prefix, so numbers are never reused.
 */

export interface ScannedDocument {
  path: string;
  /** The document ID in the root anchor, if any. */
  documentId: string | null;
  /** The section ID of each found section, by index; `null` for no anchor or a placeholder. */
  sectionIds: ReadonlyArray<string | null>;
}

export interface DocumentFix {
  /** The document ID the file's root anchor must carry. */
  documentId: string;
  /** Indexes of found sections whose IDs must be replaced with new ones. */
  renumber: Set<number>;
}

export interface ReconcileResult {
  data: SectionData;
  /** By path, for every scanned document. */
  fixes: Map<string, DocumentFix>;
}

export function reconcile(
  data: SectionData,
  scanned: readonly ScannedDocument[],
  knownPrefixes: ReadonlySet<string>,
  newUid: () => string,
): ReconcileResult {
  const documents = [...scanned].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Documents: settle each file's document ID
  const holders = new Map<string, ScannedDocument[]>();
  for (const doc of documents) {
    if (doc.documentId === null) continue;
    const list = holders.get(doc.documentId) ?? [];
    list.push(doc);
    holders.set(doc.documentId, list);
  }
  const assigned = new Map<ScannedDocument, string>();
  const taken = new Set<string>();
  for (const [documentId, files] of holders) {
    const recorded = data.documents.get(documentId)?.path;
    const keeper = files.find((doc) => doc.path === recorded) ?? files[0]!;
    assigned.set(keeper, documentId);
    taken.add(documentId);
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

  // Sections: find the occurrences of each ID
  const fixes = new Map<string, DocumentFix>();
  interface Occurrence {
    doc: ScannedDocument;
    documentId: string;
    index: number;
  }
  const occurrences = new Map<string, Occurrence[]>();
  const highest = new Map<string, number>();
  for (const doc of documents) {
    const documentId = assigned.get(doc)!;
    const fix: DocumentFix = { documentId, renumber: new Set() };
    fixes.set(doc.path, fix);
    doc.sectionIds.forEach((id, index) => {
      if (id === null) return;
      const parsed = parseSectionId(id);
      if (parsed === null || !knownPrefixes.has(parsed.prefix)) {
        fix.renumber.add(index);
        return;
      }
      highest.set(parsed.prefix, Math.max(highest.get(parsed.prefix) ?? 0, parsed.sequence));
      const list = occurrences.get(id) ?? [];
      list.push({ doc, documentId, index });
      occurrences.set(id, list);
    });
  }

  // Entries by section ID, in file order
  const entriesById = new Map<string, Array<[uid: string, entry: SectionEntry]>>();
  for (const prefixData of data.prefixes.values()) {
    for (const [uid, entry] of prefixData.sections) {
      const list = entriesById.get(entry.id) ?? [];
      list.push([uid, entry]);
      entriesById.set(entry.id, list);
    }
  }

  // The kept occurrence of each ID and the entry (CUID2) it keeps
  const kept = new Map<string, { uid: string; documentId: string }>();
  for (const [id, list] of occurrences) {
    const entries = entriesById.get(id) ?? [];
    const recorded = entries.find(([, entry]) => list.some((o) => o.documentId === entry.documentId));
    const keeper = (recorded && list.find((o) => o.documentId === recorded[1].documentId)) ?? list[0]!;
    for (const occurrence of list) if (occurrence !== keeper) fixes.get(occurrence.doc.path)!.renumber.add(occurrence.index);
    const uid = recorded?.[0] ?? entries[0]?.[0] ?? newUid();
    kept.set(id, { uid, documentId: keeper.documentId });
  }

  // The new sections files: existing entries in order, then new ones in document order
  const prefixes = new Map<string, PrefixData>();
  const prefixFor = (id: string) => parseSectionId(id)!.prefix;
  const ensure = (prefix: string) => {
    let prefixData = prefixes.get(prefix);
    if (prefixData === undefined) {
      const old = data.prefixes.get(prefix);
      let lastSequence = Math.max(old?.lastSequence ?? 0, highest.get(prefix) ?? 0);
      for (const entry of old?.sections.values() ?? []) lastSequence = Math.max(lastSequence, parseSectionId(entry.id)?.sequence ?? 0);
      prefixData = { lastSequence, sections: new Map() };
      prefixes.set(prefix, prefixData);
    }
    return prefixData;
  };
  for (const prefix of data.prefixes.keys()) ensure(prefix);
  const keptUids = new Map([...kept].map(([id, k]) => [k.uid, { id, documentId: k.documentId }]));
  for (const [prefix, prefixData] of data.prefixes) {
    for (const uid of prefixData.sections.keys()) {
      const entry = keptUids.get(uid);
      if (entry !== undefined && prefixFor(entry.id) === prefix) ensure(prefix).sections.set(uid, entry);
    }
  }
  for (const [id, { uid, documentId }] of kept) {
    const prefixData = ensure(prefixFor(id));
    if (!prefixData.sections.has(uid)) prefixData.sections.set(uid, { id, documentId });
  }

  return { data: { documents: newDocuments, prefixes }, fixes };
}
