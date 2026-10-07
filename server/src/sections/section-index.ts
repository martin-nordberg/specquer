import { createId } from "@paralleldrive/cuid2";
import type { SaveResult, SectionInfo, SectionSearchResult } from "@specquer/shared/api";
import {
  type BodyEdit,
  type FoundSection,
  anchorEdits,
  applyEdits,
  detectEol,
  findSections,
  fromLf,
  joinFrontmatter,
  rootAnchorText,
  splitFrontmatter,
  toLf,
} from "@specquer/shared/markdown";
import { baseName, isSameOrInside, renamedPath } from "@specquer/shared/paths";
import { formatSectionId } from "@specquer/shared/sections";
import type { FileService } from "../files.ts";
import { type PrefixConfig, PrefixConfigFile } from "./config.ts";
import { DataFiles, type SectionData, emptyData } from "./data.ts";
import { type DocumentFix, type ScannedDocument, reconcile } from "./reconcile.ts";

/**
 * The server's index of sections: the prefix configuration, the data files and, for each
 * sectioned document, the sections found in it. It allocates section IDs, so two tabs can never
 * hand out the same number.
 *
 * Scans (at startup and after tree loads) bring the index up to date with the files and never
 * write anything. Documents and data files are written only by changes the user makes: saving,
 * creating, renaming and deleting in Specquer, and **Add section anchors**. A data file written
 * then holds the whole reconciled state, fixes found by scans included. Updates run one at a time.
 */

interface IndexedDocument {
  path: string;
  mtimeMs: number;
  size: number;
  documentId: string | null;
  sections: FoundSection[];
}

/** A document ID as written by Specquer (a CUID2); anything else counts as none. */
function validDocumentId(value: string | undefined): string | null {
  return value !== undefined && /^[a-z][a-z0-9]{1,63}$/.test(value) ? value : null;
}

/** The file's text split for anchoring, and a way to put it back together after edits. */
function prepareText(text: string) {
  const split = splitFrontmatter(text);
  const eol = split.frontmatter === null ? detectEol(text) : split.layout.eol;
  const body = toLf(split.body);
  return { body, rebuild: (newBody: string) => joinFrontmatter(split.frontmatter, fromLf(newBody, eol), split.layout) };
}

export class SectionIndex {
  private readonly configFile: PrefixConfigFile;
  private readonly dataFiles: DataFiles;
  private config: PrefixConfig | null = null;
  private data: SectionData = emptyData();
  private fixes = new Map<string, DocumentFix>();
  private readonly documents = new Map<string, IndexedDocument>();
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly files: FileService,
    private readonly newUid: () => string = createId,
    warn?: (message: string) => void,
  ) {
    this.configFile = new PrefixConfigFile(files.root, warn);
    this.dataFiles = new DataFiles(files.root, warn);
  }

  /** Runs updates one at a time. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async load(): Promise<PrefixConfig> {
    if (!this.loaded) {
      this.data = await this.dataFiles.read();
      this.loaded = true;
    }
    this.config = await this.configFile.load();
    return this.config;
  }

  private knownPrefixes(config: PrefixConfig): Set<string> {
    return new Set([...config.prefixes(), ...this.data.prefixes.keys()]);
  }

  private scanned(): ScannedDocument[] {
    return [...this.documents.values()].map((doc) => ({
      path: doc.path,
      documentId: doc.documentId,
      sectionIds: doc.sections.map((section) => section.id),
    }));
  }

  private reconcile(config: PrefixConfig, extra?: ScannedDocument) {
    const scanned = this.scanned().filter((doc) => doc.path !== extra?.path);
    if (extra !== undefined) scanned.push(extra);
    return reconcile(this.data, scanned, this.knownPrefixes(config), this.newUid);
  }

  private apply(config: PrefixConfig): void {
    const result = this.reconcile(config);
    this.data = result.data;
    this.fixes = result.fixes;
  }

  private parse(path: string, text: string, stamp: { mtimeMs: number; size: number }): IndexedDocument {
    const sections = findSections(prepareText(text).body);
    const title = baseName(path);
    if (sections[0] !== undefined) sections[0] = { ...sections[0], title };
    return { path, ...stamp, documentId: validDocumentId(sections[0]?.anchor?.documentId), sections };
  }

  /** Reads a sectioned file into the index; files that can't be read are left out. */
  private async index(path: string): Promise<void> {
    const stamp = await this.files.fileStamp(path);
    if (stamp === undefined) {
      this.documents.delete(path);
      return;
    }
    const cached = this.documents.get(path);
    if (cached !== undefined && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size) return;
    try {
      const { text } = await this.files.readFile(path);
      this.documents.set(path, this.parse(path, text, stamp));
    } catch {
      this.documents.delete(path);
    }
  }

  private async scanFiles(): Promise<PrefixConfig> {
    const config = await this.load();
    const paths = (await this.files.listMarkdownFiles()).filter((path) => config.isSectioned(path));
    const wanted = new Set(paths);
    for (const path of this.documents.keys()) if (!wanted.has(path)) this.documents.delete(path);
    for (const path of paths) await this.index(path);
    this.apply(config);
    return config;
  }

  /** Brings the index up to date with the files. Writes nothing. */
  scan(): Promise<void> {
    return this.run(async () => {
      await this.scanFiles();
    });
  }

  private nextId(prefix: string): string {
    let prefixData = this.data.prefixes.get(prefix);
    if (prefixData === undefined) {
      prefixData = { lastSequence: 0, sections: new Map() };
      this.data.prefixes.set(prefix, prefixData);
    }
    prefixData.lastSequence++;
    return formatSectionId(prefix, prefixData.lastSequence);
  }

  /**
   * The text with its anchors added and corrected, and the body edits that make the change.
   * Allocates IDs; with `dryRun` it only reports whether anything would change.
   */
  private anchor(config: PrefixConfig, path: string, text: string, dryRun = false): { text: string; edits: BodyEdit[] } {
    const prefix = config.prefixFor(path);
    if (prefix === undefined) return { text, edits: [] };
    const { body, rebuild } = prepareText(text);
    const sections = findSections(body);
    const documentId = validDocumentId(sections[0]?.anchor?.documentId);
    const reconciled = this.reconcile(config, { path, documentId, sectionIds: sections.map((s) => s.id) });
    const fix = reconciled.fixes.get(path)!;
    const needed = sections.flatMap((section, index) => (section.id === null || fix.renumber.has(index) ? [index] : []));
    if (dryRun) {
      const changes = needed.length > 0 || sections[0]?.anchor?.documentId !== fix.documentId;
      return { text, edits: changes ? [{ from: 0, to: 0, insert: "" }] : [] };
    }
    // New numbers follow the highest known, including IDs typed into this text
    for (const [name, prefixData] of reconciled.data.prefixes) {
      const current = this.data.prefixes.get(name);
      if (current === undefined) this.data.prefixes.set(name, { lastSequence: prefixData.lastSequence, sections: new Map() });
      else current.lastSequence = Math.max(current.lastSequence, prefixData.lastSequence);
    }
    const ids = new Map(needed.map((index) => [index, this.nextId(prefix)]));
    const edits = anchorEdits(body, sections, { ids, documentId: fix.documentId });
    if (edits.length === 0) return { text, edits };
    return { text: rebuild(applyEdits(body, edits)), edits };
  }

  /** Records a file just written and writes the data files. */
  private async written(config: PrefixConfig, path: string, text: string): Promise<void> {
    const stamp = await this.files.fileStamp(path);
    if (stamp !== undefined && config.isSectioned(path)) this.documents.set(path, this.parse(path, text, stamp));
    this.apply(config);
    await this.dataFiles.write(this.data);
  }

  /**
   * Saves a file. A sectioned file gets its anchors added and corrected first; the result then
   * carries the edits, relative to the body that was sent.
   */
  save(path: string, text: string, baseVersion: string): Promise<SaveResult> {
    return this.run(async () => {
      const config = await this.load();
      if (!config.isSectioned(path)) return this.files.saveFile(path, text, baseVersion);
      await this.index(path);
      const anchored = this.anchor(config, path, text);
      const result = await this.files.saveFile(path, anchored.text, baseVersion);
      if (!result.ok) return result;
      await this.written(config, path, anchored.text);
      return anchored.edits.length === 0 ? result : { ...result, edits: anchored.edits };
    });
  }

  /** Creates a file or folder; a sectioned file starts with its root anchor. */
  create(parent: string, name: string, kind: "file" | "folder"): Promise<string | null> {
    return this.run(async () => {
      const config = await this.load();
      const path = parent === "" ? name : `${parent}/${name}`;
      const prefix = kind === "file" ? config.prefixFor(path) : undefined;
      if (prefix === undefined) return this.files.create(parent, name, kind);
      const content = rootAnchorText(this.nextId(prefix), this.newUid());
      const created = await this.files.create(parent, name, kind, content);
      if (created !== null) await this.written(config, created, content);
      return created;
    });
  }

  /** Follows a rename made through the file service and writes the data files. */
  renamed(from: string, to: string): Promise<void> {
    return this.run(async () => {
      await this.load();
      for (const [path, doc] of [...this.documents]) {
        const moved = renamedPath(path, from, to);
        if (moved === undefined) continue;
        this.documents.delete(path);
        this.documents.set(moved, { ...doc, path: moved });
      }
      for (const entry of this.data.documents.values()) entry.path = renamedPath(entry.path, from, to) ?? entry.path;
      await this.scanFiles();
      await this.dataFiles.write(this.data);
    });
  }

  /** Follows a deletion made through the file service and writes the data files. */
  deleted(path: string): Promise<void> {
    return this.run(async () => {
      for (const doc of [...this.documents.keys()]) if (isSameOrInside(doc, path)) this.documents.delete(doc);
      await this.scanFiles();
      await this.dataFiles.write(this.data);
    });
  }

  /**
   * **Add section anchors**: the sectioned files in a folder whose anchors would change, and
   * unless `dryRun`, those files rewritten. A file changed on disk during the run is read again,
   * never overwritten blindly.
   */
  anchorFolder(folder: string, dryRun: boolean): Promise<string[]> {
    return this.run(async () => {
      const config = await this.scanFiles();
      const changed: string[] = [];
      for (const path of [...this.documents.keys()].sort()) {
        if (!isSameOrInside(path, folder)) continue;
        for (let attempt = 0; attempt < 3; attempt++) {
          const file = await this.files.readFile(path);
          const anchored = this.anchor(config, path, file.text, dryRun);
          if (anchored.edits.length === 0) break;
          if (dryRun) {
            changed.push(path);
            break;
          }
          const result = await this.files.saveFile(path, anchored.text, file.version);
          if (!result.ok) continue;
          changed.push(path);
          const stamp = await this.files.fileStamp(path);
          if (stamp !== undefined) this.documents.set(path, this.parse(path, anchored.text, stamp));
          this.apply(config);
          break;
        }
      }
      if (!dryRun) await this.dataFiles.write(this.data);
      return changed;
    });
  }

  /** The sections of one document, as last indexed. */
  sectionsOf(path: string): Promise<SectionInfo[]> {
    return this.run(async () => {
      const config = await this.load();
      if (!config.isSectioned(path)) return [];
      await this.index(path);
      this.apply(config);
      const doc = this.documents.get(path);
      return doc === undefined ? [] : this.describe(doc);
    });
  }

  private describe(doc: IndexedDocument): SectionInfo[] {
    const fix = this.fixes.get(doc.path);
    const uids = new Map<string, string>();
    for (const prefixData of this.data.prefixes.values()) {
      for (const [uid, entry] of prefixData.sections) if (entry.documentId === fix?.documentId) uids.set(entry.id, uid);
    }
    return doc.sections.flatMap((section, index) => {
      if (section.id === null) return [];
      const duplicate = fix?.renumber.has(index) ?? false;
      return [
        {
          id: section.id,
          uid: duplicate ? null : (uids.get(section.id) ?? null),
          kind: section.kind,
          title: section.title,
          ...(section.depth === undefined ? {} : { depth: section.depth }),
        },
      ];
    });
  }

  /** Sections whose ID or title starts with the query (or whose title contains it), across documents. */
  search(query: string, limit: number, path?: string): Promise<SectionSearchResult[]> {
    return this.run(async () => {
      const q = query.trim().toLowerCase();
      const starts: SectionSearchResult[] = [];
      const contains: SectionSearchResult[] = [];
      const docs = path === undefined ? [...this.documents.values()] : [this.documents.get(path)].filter((d) => d !== undefined);
      for (const doc of docs.sort((a, b) => (a.path < b.path ? -1 : 1))) {
        for (const section of this.describe(doc)) {
          const id = section.id.toLowerCase();
          const title = section.title.toLowerCase();
          if (q === "" || id.startsWith(q) || title.startsWith(q)) starts.push({ ...section, path: doc.path });
          else if (title.includes(q) || id.includes(q)) contains.push({ ...section, path: doc.path });
        }
      }
      return [...starts, ...contains].slice(0, limit);
    });
  }
}
