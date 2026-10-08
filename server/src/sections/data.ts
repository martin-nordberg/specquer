import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isPrefix, isSectionId, isUid, parseSectionId } from "@specquer/shared/sections";
import { isMap, isScalar, parseDocument } from "yaml";
import { writeAtomically } from "../files.ts";
import { SHARED_FOLDER } from "./config.ts";

/**
 * The committed data files in `.specquer/shared/`:
 *
 * - `documents.yaml`: every sectioned document, by document ID (its root section's UID), with
 *   its path.
 * - `<prefix>/sections.yaml`: for each prefix, the highest sequence number ever assigned, every
 *   section by its UID with its section ID and document ID (the root sections included, keyed by
 *   the document ID), and the retired sections: those no document holds any more, by UID, with
 *   the ID they had. A section restored later is told apart from its ID reused by its UID.
 *
 * Every entry can be rebuilt from the documents, which carry the UIDs; the files are the last
 * known state, which tells an edited ID or a reused one from a new one.
 *
 * One entry per line, in the order entries were added, so that Git merges conflict only where
 * both sides appended. Reading tolerates damage: merge conflict markers are dropped (keeping both
 * sides, the earlier entry winning), invalid entries skipped, an unreadable file treated as
 * empty. Nothing here ever stops the server. The files are read again when they change on disk
 * (a pull or a branch switch), see `DataFiles.changed`.
 */

export interface DocumentEntry {
  path: string;
}

export interface SectionEntry {
  id: string;
  documentId: string;
}

export interface RetiredEntry {
  id: string;
}

export interface PrefixData {
  lastSequence: number;
  /** Live sections by UID, in file order. */
  sections: Map<string, SectionEntry>;
  /** Retired sections by UID, in file order. */
  retired: Map<string, RetiredEntry>;
}

export function emptyPrefixData(lastSequence = 0): PrefixData {
  return { lastSequence, sections: new Map(), retired: new Map() };
}

export interface SectionData {
  /** By document ID, in file order. */
  documents: Map<string, DocumentEntry>;
  /** By prefix. */
  prefixes: Map<string, PrefixData>;
}

export function emptyData(): SectionData {
  return { documents: new Map(), prefixes: new Map() };
}

export const DOCUMENTS_FILE = "documents.yaml";
export const SECTIONS_FILE = "sections.yaml";

const DOCUMENTS_HEADER = "# Specquer's sectioned documents, by document ID; written by Specquer. Commit this file.\n";
const SECTIONS_HEADER = "# Specquer's sections for one prefix, by unique ID; written by Specquer. Commit this file.\n";

const CONFLICT_MARKER = /^(<{7}|={7}|>{7}|\|{7})( .*)?$/;

/** Parses YAML that may hold merge conflict markers, keeping both sides of each conflict. */
function parseTolerant(text: string) {
  const lines = text.split(/\r?\n/);
  return parseDocument(lines.filter((line) => !CONFLICT_MARKER.test(line)).join("\n"), { uniqueKeys: false });
}

/** The pairs of a top-level mapping, first occurrence of each key first. */
function mapEntries(doc: ReturnType<typeof parseDocument>, key: string): Array<[string, unknown]> {
  const root = doc.contents;
  if (!isMap(root)) return [];
  const entries: Array<[string, unknown]> = [];
  for (const pair of root.items) {
    if (!isScalar(pair.key) || pair.key.value !== key || !isMap(pair.value)) continue;
    for (const item of pair.value.items) {
      if (!isScalar(item.key)) continue;
      entries.push([String(item.key.value), item.value === null ? null : (item.value as { toJSON(): unknown }).toJSON()]);
    }
  }
  return entries;
}

export function parseDocumentsFile(text: string): Map<string, DocumentEntry> {
  const documents = new Map<string, DocumentEntry>();
  const doc = parseTolerant(text);
  for (const [key, value] of mapEntries(doc, "documents")) {
    const path = (value as { path?: unknown } | null)?.path;
    if (!isUid(key) || typeof path !== "string" || documents.has(key)) continue;
    documents.set(key, { path });
  }
  return documents;
}

export function parseSectionsFile(text: string, prefix: string): PrefixData {
  const doc = parseTolerant(text);
  // Both sides of a conflict on `lastSequence` count: take the highest
  let lastSequence = 0;
  for (const match of text.matchAll(/^lastSequence:\s*(\d+)\s*$/gm)) lastSequence = Math.max(lastSequence, Number(match[1]));
  const sections = new Map<string, SectionEntry>();
  for (const [key, value] of mapEntries(doc, "sections")) {
    const entry = value as { id?: unknown; documentId?: unknown } | null;
    if (!isUid(key) || sections.has(key) || typeof entry?.id !== "string" || typeof entry.documentId !== "string") continue;
    if (!isSectionId(entry.id) || parseSectionId(entry.id)!.prefix !== prefix || !isUid(entry.documentId)) continue;
    sections.set(key, { id: entry.id, documentId: entry.documentId });
  }
  // A section live on one side of a merge and retired on the other is live
  const retired = new Map<string, RetiredEntry>();
  for (const [key, value] of mapEntries(doc, "retired")) {
    const entry = value as { id?: unknown } | null;
    if (!isUid(key) || sections.has(key) || retired.has(key) || typeof entry?.id !== "string") continue;
    if (!isSectionId(entry.id) || parseSectionId(entry.id)!.prefix !== prefix) continue;
    retired.set(key, { id: entry.id });
  }
  return { lastSequence, sections, retired };
}

/** A YAML scalar for a flow mapping: plain when that is safe, otherwise double-quoted. */
function scalar(value: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(value) && !/^(true|false|null|yes|no|on|off|~)$/i.test(value) && !/^[0-9.]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

export function formatDocumentsFile(documents: ReadonlyMap<string, DocumentEntry>): string {
  const lines = [...documents].map(([key, entry]) => `  ${key}: { path: ${scalar(entry.path)} }`);
  return `${DOCUMENTS_HEADER}documents:${lines.length === 0 ? " {}" : ""}\n${lines.map((l) => `${l}\n`).join("")}`;
}

export function formatSectionsFile(data: PrefixData): string {
  const lines = [...data.sections].map(([key, entry]) => `  ${key}: { id: ${entry.id}, documentId: ${scalar(entry.documentId)} }`);
  const retired = [...data.retired].map(([key, entry]) => `  ${key}: { id: ${entry.id} }`);
  const block = (name: string, items: string[]) => `${name}:${items.length === 0 ? " {}" : ""}\n${items.map((l) => `${l}\n`).join("")}`;
  return `${SECTIONS_HEADER}lastSequence: ${data.lastSequence}\n${block("sections", lines)}${retired.length === 0 ? "" : block("retired", retired)}`;
}

/** Reads and writes the data files under a root folder, writing only files whose content changed. */
export class DataFiles {
  readonly folder: string;
  /** The text last read or written for each file, to skip writes that change nothing. */
  private readonly written = new Map<string, string>();
  /** The files' modification times and sizes as last read or written; `null` before the first read. */
  private signature: string | null = null;

  constructor(
    root: string,
    private readonly warn: (message: string) => void = (message) => console.warn(`specquer: ${message}`),
  ) {
    this.folder = join(root, SHARED_FOLDER);
  }

  private async readText(file: string): Promise<string | null> {
    try {
      const text = await Bun.file(file).text();
      this.written.set(file, text);
      return text;
    } catch {
      return null;
    }
  }

  /** The data files' modification times and sizes, and which prefix folders exist. */
  private async currentSignature(): Promise<string> {
    const stamp = async (file: string) => {
      try {
        const info = await stat(file);
        return `${info.mtimeMs}:${info.size}`;
      } catch {
        return "-";
      }
    };
    const parts = [await stamp(join(this.folder, DOCUMENTS_FILE))];
    for (const prefix of await this.prefixFolders()) parts.push(`${prefix}=${await stamp(join(this.folder, prefix, SECTIONS_FILE))}`);
    return parts.join("|");
  }

  private async prefixFolders(): Promise<string[]> {
    try {
      return (await readdir(this.folder, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && isPrefix(e.name))
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  /** Whether the files changed on disk since they were last read or written here. */
  async changed(): Promise<boolean> {
    return this.signature === null || (await this.currentSignature()) !== this.signature;
  }

  async read(): Promise<SectionData> {
    this.signature = await this.currentSignature();
    // Files that vanished (a branch switch) must be written again, even with the same content
    this.written.clear();
    const data = emptyData();
    const documentsText = await this.readText(join(this.folder, DOCUMENTS_FILE));
    if (documentsText !== null) data.documents = this.guard(DOCUMENTS_FILE, () => parseDocumentsFile(documentsText), new Map());
    for (const prefix of await this.prefixFolders()) {
      const text = await this.readText(join(this.folder, prefix, SECTIONS_FILE));
      if (text === null) continue;
      data.prefixes.set(prefix, this.guard(`${prefix}/${SECTIONS_FILE}`, () => parseSectionsFile(text, prefix), emptyPrefixData()));
    }
    return data;
  }

  private guard<T>(name: string, read: () => T, fallback: T): T {
    try {
      return read();
    } catch (err) {
      this.warn(`${join(SHARED_FOLDER, name)} is unreadable (${(err as Error).message}); it will be rebuilt from the documents`);
      return fallback;
    }
  }

  /** Writes the data files whose content changed; empty data creates no file. */
  async write(data: SectionData): Promise<void> {
    await this.writeFile(join(this.folder, DOCUMENTS_FILE), formatDocumentsFile(data.documents), data.documents.size === 0);
    for (const [prefix, prefixData] of data.prefixes) {
      const empty = prefixData.lastSequence === 0 && prefixData.sections.size === 0 && prefixData.retired.size === 0;
      await this.writeFile(join(this.folder, prefix, SECTIONS_FILE), formatSectionsFile(prefixData), empty);
    }
    this.signature = await this.currentSignature();
  }

  private async writeFile(file: string, text: string, empty: boolean): Promise<void> {
    const previous = this.written.get(file);
    if (previous === text || (empty && previous === undefined)) return;
    await mkdir(join(file, ".."), { recursive: true });
    await writeAtomically(file, text);
    this.written.set(file, text);
  }
}
