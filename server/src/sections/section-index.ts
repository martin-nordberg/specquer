import { init } from "@paralleldrive/cuid2";
import type { SaveResult, SectionInfo, SectionNotice, SectionProblem, SectionSearchResult } from "@specquer/shared/api";
import {
  type BodyEdit,
  type FoundSection,
  type StrayAnchor,
  analyzeBody,
  anchorEdits,
  applyEdits,
  detectEol,
  fromLf,
  hasConflictMarkers,
  joinFrontmatter,
  rootAnchorText,
  splitFrontmatter,
  toLf,
} from "@specquer/shared/markdown";
import { baseName, isSameOrInside, renamedPath } from "@specquer/shared/paths";
import { UID_LENGTH, formatSectionId } from "@specquer/shared/sections";
import type { FileService } from "../files.ts";
import { type PrefixConfig, PrefixConfigFile } from "./config.ts";
import { DataFiles, type SectionData, emptyData, emptyPrefixData } from "./data.ts";
import { type DocumentFix, type Duplicate, type RenumberRequest, type ScannedDocument, reconcile } from "./reconcile.ts";

/**
 * The server's index of sections: the prefix configuration, the data files and, for each
 * sectioned document, the sections found in it. It allocates section IDs, so two tabs can never
 * hand out the same number.
 *
 * Scans (at startup and after tree loads) bring the index up to date with the files and never
 * write anything. Every operation that issues IDs, settles duplicates or reports problems scans
 * first, so it never works from a stale view of files changed outside Specquer; the scan reads
 * only files whose modification time or size changed. The data files are read again when they
 * change on disk (a pull, a branch switch).
 *
 * Documents and data files are written only by changes the user makes: saving, creating,
 * renaming and deleting in Specquer, renumbering a duplicate, and **Add section anchors**. A data
 * file written then holds the whole reconciled state, fixes found by scans included. Updates run
 * one at a time.
 */

interface IndexedDocument {
  path: string;
  mtimeMs: number;
  size: number;
  sections: FoundSection[];
  strays: StrayAnchor[];
  /** Holds merge conflict markers: never anchored until they are resolved. */
  frozen: boolean;
}

/** The file's text split for anchoring, and a way to put it back together after edits. */
function prepareText(text: string) {
  const split = splitFrontmatter(text);
  const eol = split.frontmatter === null ? detectEol(text) : split.layout.eol;
  const body = toLf(split.body);
  return { body, rebuild: (newBody: string) => joinFrontmatter(split.frontmatter, fromLf(newBody, eol), split.layout) };
}

interface Anchored {
  text: string;
  edits: BodyEdit[];
  notices: SectionNotice[];
}

export class SectionIndex {
  private readonly configFile: PrefixConfigFile;
  private readonly dataFiles: DataFiles;
  private config: PrefixConfig | null = null;
  private data: SectionData = emptyData();
  private fixes = new Map<string, DocumentFix>();
  private duplicates: Duplicate[] = [];
  private readonly documents = new Map<string, IndexedDocument>();
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly files: FileService,
    private readonly newUid: () => string = init({ length: UID_LENGTH }),
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

  /** Loads the configuration, and the data files when they changed on disk since last read or written. */
  private async load(): Promise<PrefixConfig> {
    if (!this.loaded || (await this.dataFiles.changed())) {
      const fresh = await this.dataFiles.read();
      // Numbers issued in this session stay issued, even if they never reached the files
      for (const [prefix, prefixData] of this.data.prefixes) {
        const read = fresh.prefixes.get(prefix);
        if (read !== undefined) read.lastSequence = Math.max(read.lastSequence, prefixData.lastSequence);
        else if (prefixData.lastSequence > 0) fresh.prefixes.set(prefix, emptyPrefixData(prefixData.lastSequence));
      }
      this.data = fresh;
      this.loaded = true;
    }
    this.config = await this.configFile.load();
    return this.config;
  }

  private knownPrefixes(config: PrefixConfig): Set<string> {
    return new Set([...config.prefixes(), ...this.data.prefixes.keys()]);
  }

  private analyze(body: string) {
    return analyzeBody(body, { isDocumentUid: (uid) => this.data.documents.has(uid) });
  }

  private static scannedOf(path: string, sections: readonly FoundSection[], frozen: boolean): ScannedDocument {
    return { path, frozen, sections: sections.map((section) => ({ id: section.id, uid: section.uid })) };
  }

  private scanned(): ScannedDocument[] {
    return [...this.documents.values()].map((doc) => SectionIndex.scannedOf(doc.path, doc.sections, doc.frozen));
  }

  private reconcile(config: PrefixConfig, extra?: ScannedDocument, requests?: RenumberRequest[]) {
    const scanned = this.scanned().filter((doc) => doc.path !== extra?.path);
    if (extra !== undefined) scanned.push(extra);
    return reconcile(this.data, scanned, this.knownPrefixes(config), this.newUid, requests);
  }

  private apply(config: PrefixConfig): void {
    const result = this.reconcile(config);
    this.data = result.data;
    this.fixes = result.fixes;
    this.duplicates = result.duplicates;
  }

  private parse(path: string, text: string, stamp: { mtimeMs: number; size: number }): IndexedDocument {
    const { body } = prepareText(text);
    const { sections, strays } = this.analyze(body);
    if (sections[0] !== undefined) sections[0] = { ...sections[0], title: baseName(path) };
    return { path, ...stamp, sections, strays, frozen: hasConflictMarkers(body) };
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
      prefixData = emptyPrefixData();
      this.data.prefixes.set(prefix, prefixData);
    }
    prefixData.lastSequence++;
    return formatSectionId(prefix, prefixData.lastSequence);
  }

  /**
   * The text with its anchors added and corrected, the body edits that make the change, and what
   * the user should be told. Allocates IDs; with `dryRun` it only reports whether anything would
   * change. A file with merge conflict markers is left as it is.
   */
  private anchor(config: PrefixConfig, path: string, text: string, dryRun = false, requests?: RenumberRequest[]): Anchored {
    const prefix = config.prefixFor(path);
    if (prefix === undefined) return { text, edits: [], notices: [] };
    const { body, rebuild } = prepareText(text);
    if (hasConflictMarkers(body)) return { text, edits: [], notices: dryRun ? [] : [{ kind: "not-anchored" }] };
    const sections = this.analyze(body).sections;
    const reconciled = this.reconcile(config, SectionIndex.scannedOf(path, sections, false), requests);
    const fix = reconciled.fixes.get(path)!;
    const needed = sections.flatMap((section, index) => (section.id === null || fix.renumber.has(index) ? [index] : []));
    if (dryRun) {
      const changes = needed.length > 0 || fix.restore.size > 0 || fix.uids.size > 0;
      return { text, edits: changes ? [{ from: 0, to: 0, insert: "" }] : [], notices: [] };
    }
    // New numbers follow the highest known, including IDs typed into this text
    for (const [name, prefixData] of reconciled.data.prefixes) {
      const current = this.data.prefixes.get(name);
      if (current === undefined) this.data.prefixes.set(name, emptyPrefixData(prefixData.lastSequence));
      else current.lastSequence = Math.max(current.lastSequence, prefixData.lastSequence);
    }
    const ids = new Map(needed.map((index) => [index, this.nextId(prefix)]));
    for (const [index, id] of fix.restore) ids.set(index, id);
    const edits = anchorEdits(body, sections, { ids, uids: fix.uids });
    const title = (index: number) => (index === 0 ? baseName(path) : sections[index]!.title);
    const notices: SectionNotice[] = [];
    for (const [index, reason] of fix.renumber) {
      notices.push({ kind: "renumbered", reason, id: sections[index]!.anchor!.rawId, newId: ids.get(index)!, title: title(index) });
    }
    for (const [index, id] of fix.restore) notices.push({ kind: "restored", id: sections[index]!.id!, newId: id, title: title(index) });
    for (const index of fix.uidReplaced) notices.push({ kind: "uid-replaced", id: sections[index]!.id!, title: title(index) });
    if (edits.length === 0) return { text, edits, notices };
    return { text: rebuild(applyEdits(body, edits)), edits, notices };
  }

  /** Records a file just written and writes the data files. */
  private async written(config: PrefixConfig, path: string, text: string): Promise<void> {
    const stamp = await this.files.fileStamp(path);
    if (stamp !== undefined && config.isSectioned(path)) this.documents.set(path, this.parse(path, text, stamp));
    this.apply(config);
    await this.dataFiles.write(this.data);
  }

  private static result(result: SaveResult, anchored: Anchored): SaveResult {
    if (!result.ok) return result;
    return {
      ...result,
      ...(anchored.edits.length === 0 ? {} : { edits: anchored.edits }),
      ...(anchored.notices.length === 0 ? {} : { notices: anchored.notices }),
    };
  }

  /**
   * Saves a file. A sectioned file gets its anchors added and corrected first; the result then
   * carries the edits, relative to the body that was sent, and what the user should be told.
   */
  save(path: string, text: string, baseVersion: string): Promise<SaveResult> {
    return this.run(async () => {
      if (!(await this.load()).isSectioned(path)) return this.files.saveFile(path, text, baseVersion);
      const config = await this.scanFiles();
      const anchored = this.anchor(config, path, text);
      const result = await this.files.saveFile(path, anchored.text, baseVersion);
      if (!result.ok) return result;
      await this.written(config, path, anchored.text);
      return SectionIndex.result(result, anchored);
    });
  }

  /** Creates a file or folder; a sectioned file starts with its root anchor. */
  create(parent: string, name: string, kind: "file" | "folder"): Promise<string | null> {
    return this.run(async () => {
      const path = parent === "" ? name : `${parent}/${name}`;
      if (kind === "folder" || !(await this.load()).isSectioned(path)) return this.files.create(parent, name, kind);
      const config = await this.scanFiles();
      const content = rootAnchorText(this.nextId(config.prefixFor(path)!), this.newUid());
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
   * never overwritten blindly. Files with merge conflict markers are left alone.
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

  /**
   * Gives one occurrence of a duplicate or collision a new ID, at the user's request: the file is
   * rewritten as a save would, if it is still at `baseVersion`. The edits are relative to the
   * body on disk.
   */
  renumber(path: string, id: string, uid: string | null, baseVersion: string): Promise<SaveResult> {
    return this.run(async () => {
      const config = await this.scanFiles();
      const file = await this.files.readFile(path);
      if (file.version !== baseVersion) return { ok: false, reason: "conflict", version: file.version };
      if (!config.isSectioned(path)) return { ok: true, version: file.version };
      const sections = this.analyze(prepareText(file.text).body).sections;
      const index = sections.findIndex((section) => section.id === id && section.uid === uid);
      if (index < 0) return { ok: true, version: file.version };
      const anchored = this.anchor(config, path, file.text, false, [{ path, index }]);
      const result = await this.files.saveFile(path, anchored.text, baseVersion);
      if (!result.ok) return result;
      await this.written(config, path, anchored.text);
      return SectionIndex.result(result, anchored);
    });
  }

  /**
   * The problems in a folder's sectioned files: duplicates and collisions waiting for the user,
   * stray anchors, and files with merge conflict markers.
   */
  problems(folder: string): Promise<SectionProblem[]> {
    return this.run(async () => {
      await this.scanFiles();
      const problems: SectionProblem[] = [];
      for (const duplicate of this.duplicates) {
        if (!duplicate.occurrences.some((o) => isSameOrInside(o.path, folder))) continue;
        problems.push({
          kind: duplicate.kind,
          id: duplicate.id,
          occurrences: duplicate.occurrences.map((o) => {
            const section = this.documents.get(o.path)?.sections[o.index];
            return { path: o.path, uid: section?.uid ?? null, title: section?.title ?? "", keeps: o.keeps };
          }),
        });
      }
      for (const doc of [...this.documents.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
        if (!isSameOrInside(doc.path, folder)) continue;
        if (doc.frozen) problems.push({ kind: "conflict-markers", path: doc.path });
        for (const stray of doc.strays) problems.push({ kind: "stray", path: doc.path, id: stray.id, line: stray.line });
      }
      return problems;
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
    const titleOf = (path: string, index: number) => this.documents.get(path)?.sections[index]?.title ?? "";
    return doc.sections.flatMap((section, index) => {
      if (section.id === null) return [];
      const duplicate = this.duplicates.find((d) => d.occurrences.some((o) => o.path === doc.path && o.index === index));
      const self = duplicate?.occurrences.find((o) => o.path === doc.path && o.index === index);
      return [
        {
          id: section.id,
          uid: fix?.renumber.has(index) ? null : section.uid,
          kind: section.kind,
          title: section.title,
          ...(section.depth === undefined ? {} : { depth: section.depth }),
          ...(duplicate === undefined || self === undefined
            ? {}
            : {
                problem: {
                  kind: duplicate.kind,
                  keeps: self.keeps,
                  others: duplicate.occurrences.filter((o) => o !== self).map((o) => ({ path: o.path, title: titleOf(o.path, o.index) })),
                },
              }),
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
