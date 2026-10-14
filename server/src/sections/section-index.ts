import { init } from "@paralleldrive/cuid2";
import type { SaveResult, SectionInfo, SectionNotice, SectionProblem, SectionSearchResult, SectionStatusLists } from "@specquer/shared/api";
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
import { UID_LENGTH, formatSectionId, sectionStatuses } from "@specquer/shared/sections";
import type { FileService } from "../files.ts";
import { gitTrackedFiles } from "../git.ts";
import { type FolderConfig, FolderConfigs } from "./folder-config.ts";
import { PrefixConfigs, PrefixSettings } from "./prefix-config.ts";
import { sectionPrefixes } from "./prefixes.ts";
import { DataFiles, type SectionData, documentIds, emptyData, emptyPrefixData } from "./data.ts";
import { type CopiedDocument, type DocumentFix, type Duplicate, type RenumberRequest, type ScannedDocument, reconcile } from "./reconcile.ts";

/**
 * The server's index of sections: the folder configuration, the data files and, for each
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
 *
 * When a whole file was copied, the original keeps the document ID: the file where this session
 * last saw the document alone, or else the one Git tracks. Otherwise the copy waits for the user
 * (Step 007); nothing records documents by path.
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

/** A section that keeps its UID with an ID in another prefix (`XYZ-?`), recorded once its file is written. */
interface PrefixMove {
  uid: string;
  documentId: string;
  id: string;
  /** The ID recorded for the UID before, retired so it is never reused. */
  oldId: string | null;
}

interface Anchored {
  text: string;
  edits: BodyEdit[];
  notices: SectionNotice[];
  moves?: PrefixMove[];
}

export class SectionIndex {
  private readonly configFiles: FolderConfigs;
  private readonly dataFiles: DataFiles;
  private readonly prefixConfigs: PrefixConfigs;
  private config: FolderConfig | null = null;
  /** The prefixes' settings (allowed statuses), as last loaded. */
  private prefixSettings = PrefixSettings.empty;
  private data: SectionData = emptyData();
  private fixes = new Map<string, DocumentFix>();
  private duplicates: Duplicate[] = [];
  private copiedDocuments: CopiedDocument[] = [];
  /** Document IDs recorded or found, for recognizing root anchors. */
  private knownDocumentIds = new Set<string>();
  /** Where this session last saw each document ID held by one file alone. */
  private readonly lastSeen = new Map<string, string>();
  /** For document IDs held by several files: the original, from `lastSeen` or Git. */
  private originals = new Map<string, string>();
  /** Git's answers, by document ID and paths, so a scan asks once per set of copies. */
  private readonly gitOriginals = new Map<string, string | null>();
  private readonly documents = new Map<string, IndexedDocument>();
  /** Folders below the root holding a `.specquer` folder of their own, from the last scan. */
  private nested: string[] = [];
  /** The nested folders already reported in the log. */
  private readonly reportedNested = new Set<string>();
  private readonly warn: (message: string) => void;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly files: FileService,
    private readonly newUid: () => string = init({ length: UID_LENGTH }),
    warn?: (message: string) => void,
  ) {
    this.warn = warn ?? ((message) => console.warn(`specquer: ${message}`));
    this.configFiles = new FolderConfigs(files.root, async () => (await files.listFiles()).configs, warn);
    this.dataFiles = new DataFiles(files.root, warn);
    this.prefixConfigs = new PrefixConfigs(files.root, warn);
  }

  /** Runs updates one at a time. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Loads the configuration and the prefixes' settings, and the data files when they changed on
   * disk since last read or written.
   */
  private async load(): Promise<FolderConfig> {
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
    this.config = await this.configFiles.load();
    this.prefixSettings = await this.prefixConfigs.load();
    return this.config;
  }

  /** Each section's status, for a document in a folder with this default prefix. */
  private statusesOf(sections: readonly FoundSection[], folderPrefix: string | undefined) {
    const settings = this.prefixSettings;
    return sectionStatuses(sections, { allowed: (prefix) => settings.allowed(prefix), ...(folderPrefix === undefined ? {} : { folderPrefix }) });
  }

  /** Statuses written in another spelling than the allowed value (case, surrounding spaces), by section. */
  private statusCorrections(sections: readonly FoundSection[], folderPrefix: string): Map<number, string> {
    const corrections = new Map<number, string>();
    this.statusesOf(sections, folderPrefix).forEach((status, index) => {
      if (status.own !== null && status.canonical !== undefined && status.own !== status.canonical) corrections.set(index, status.canonical);
    });
    return corrections;
  }

  private knownPrefixes(config: FolderConfig): Set<string> {
    return new Set([...config.prefixes(), ...this.data.prefixes.keys()]);
  }

  private analyze(body: string) {
    return analyzeBody(body, { isDocumentUid: (uid) => this.knownDocumentIds.has(uid) });
  }

  private static scannedOf(path: string, sections: readonly FoundSection[], frozen: boolean): ScannedDocument {
    return {
      path,
      frozen,
      sections: sections.map((section) => ({
        id: section.id,
        uid: section.uid,
        ...(section.requestedPrefix === undefined ? {} : { requestedPrefix: section.requestedPrefix }),
      })),
    };
  }

  private scanned(): ScannedDocument[] {
    return [...this.documents.values()].map((doc) => SectionIndex.scannedOf(doc.path, doc.sections, doc.frozen));
  }

  private reconcile(config: FolderConfig, extra?: ScannedDocument, requests?: RenumberRequest[], copyRequests?: string[]) {
    const scanned = this.scanned().filter((doc) => doc.path !== extra?.path);
    if (extra !== undefined) scanned.push(extra);
    return reconcile(this.data, scanned, this.knownPrefixes(config), this.newUid, requests, {
      originals: this.originals,
      ...(copyRequests === undefined ? {} : { copyRequests }),
    });
  }

  private apply(config: FolderConfig): void {
    const result = this.reconcile(config);
    this.data = result.data;
    this.fixes = result.fixes;
    this.duplicates = result.duplicates;
    this.copiedDocuments = result.copiedDocuments;
    this.knownDocumentIds = new Set([...documentIds(result.data), ...result.documents.keys()]);
    // A document ID held by one file alone: remember where, to tell the original from a later copy
    const holders = new Map<string, string[]>();
    for (const doc of this.documents.values()) {
      const uid = doc.sections[0]?.uid;
      if (uid !== null && uid !== undefined) holders.set(uid, [...(holders.get(uid) ?? []), doc.path]);
    }
    for (const [uid, paths] of holders) if (paths.length === 1) this.lastSeen.set(uid, paths[0]!);
  }

  /**
   * The originals of document IDs held by several files: where this session last saw the
   * document alone, or else the one file Git's index tracks.
   */
  private async findOriginals(): Promise<void> {
    const holders = new Map<string, string[]>();
    for (const doc of this.documents.values()) {
      const uid = doc.sections[0]?.uid;
      if (uid !== null && uid !== undefined) holders.set(uid, [...(holders.get(uid) ?? []), doc.path]);
    }
    const originals = new Map<string, string>();
    for (const [uid, paths] of holders) {
      if (paths.length < 2) continue;
      const seen = this.lastSeen.get(uid);
      if (seen !== undefined && paths.includes(seen)) {
        originals.set(uid, seen);
        continue;
      }
      const key = [uid, ...paths.sort()].join("\0");
      if (!this.gitOriginals.has(key)) {
        const tracked = await gitTrackedFiles(this.files.root, paths);
        this.gitOriginals.set(key, tracked?.length === 1 ? tracked[0]! : null);
      }
      const original = this.gitOriginals.get(key);
      if (original !== null && original !== undefined) originals.set(uid, original);
    }
    this.originals = originals;
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

  private async scanFiles(): Promise<FolderConfig> {
    const listed = await this.files.listFiles();
    this.configFiles.setFiles(listed.configs);
    this.nested = listed.nested;
    for (const folder of this.nested) {
      if (this.reportedNested.has(folder)) continue;
      this.reportedNested.add(folder);
      this.warn(`${folder}/.specquer/ belongs to another Specquer inside this one; its section data is ignored here`);
    }
    const config = await this.load();
    const paths = listed.markdown.filter((path) => config.isSectioned(path));
    const wanted = new Set(paths);
    for (const path of this.documents.keys()) if (!wanted.has(path)) this.documents.delete(path);
    for (const path of paths) await this.index(path);
    await this.findOriginals();
    this.apply(config);
    return config;
  }

  /** Reads the folder configuration again on the next load, after Specquer wrote or deleted a file. */
  configChanged(): void {
    this.configFiles.invalidate();
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
  private anchor(config: FolderConfig, path: string, text: string, dryRun = false, requests?: RenumberRequest[], copyRequests?: string[]): Anchored {
    const prefix = config.prefixFor(path);
    if (prefix === undefined) return { text, edits: [], notices: [] };
    const { body, rebuild } = prepareText(text);
    if (hasConflictMarkers(body)) return { text, edits: [], notices: dryRun ? [] : [{ kind: "not-anchored" }] };
    const sections = this.analyze(body).sections;
    const reconciled = this.reconcile(config, SectionIndex.scannedOf(path, sections, false), requests, copyRequests);
    // A copy whose original isn't known is left alone until the user says which file is the copy
    if (reconciled.copiedDocuments.some((copied) => copied.paths.includes(path))) {
      return { text, edits: [], notices: dryRun ? [] : [{ kind: "not-anchored", reason: "copied-document" }] };
    }
    const fix = reconciled.fixes.get(path)!;
    const needed = sections.flatMap((section, index) => (section.id === null || fix.renumber.has(index) ? [index] : []));
    if (dryRun) {
      const changes = needed.length > 0 || fix.restore.size > 0 || fix.uids.size > 0 || this.statusCorrections(sections, prefix).size > 0;
      return { text, edits: changes ? [{ from: 0, to: 0, insert: "" }] : [], notices: [] };
    }
    // New numbers follow the highest known, including IDs typed into this text
    for (const [name, prefixData] of reconciled.data.prefixes) {
      const current = this.data.prefixes.get(name);
      if (current === undefined) this.data.prefixes.set(name, emptyPrefixData(prefixData.lastSequence));
      else current.lastSequence = Math.max(current.lastSequence, prefixData.lastSequence);
    }
    // Each new ID in its section's prefix: requested, its own, or its parent's
    const prefixes = sectionPrefixes(sections, prefix, this.knownPrefixes(config));
    const ids = new Map(needed.map((index) => [index, this.nextId(prefixes[index]!)]));
    for (const [index, id] of fix.restore) ids.set(index, id);
    // Statuses are checked against each section's prefix once its new ID is given
    const renamed = sections.map((section, index) => {
      const id = ids.get(index);
      return id === undefined ? section : { ...section, id, requestedPrefix: undefined };
    });
    const statuses = this.statusCorrections(renamed, prefix);
    const edits = anchorEdits(body, sections, { ids, uids: fix.uids, statuses });
    const title = (index: number) => (index === 0 ? baseName(path) : sections[index]!.title);
    const notices: SectionNotice[] = [];
    for (const [index, reason] of fix.renumber) {
      const id = fix.prefixChanges.get(index) ?? sections[index]!.anchor!.rawId;
      notices.push({ kind: "renumbered", reason, id, newId: ids.get(index)!, title: title(index) });
    }
    const moves: PrefixMove[] = [...fix.prefixChanges].map(([index, oldId]) => ({
      uid: index === 0 ? fix.documentId : sections[index]!.uid!,
      documentId: fix.documentId,
      id: ids.get(index)!,
      oldId,
    }));
    for (const [index, id] of fix.restore) notices.push({ kind: "restored", id: sections[index]!.id!, newId: id, title: title(index) });
    for (const index of fix.uidReplaced) notices.push({ kind: "uid-replaced", id: sections[index]!.id!, title: title(index) });
    if (edits.length === 0) return { text, edits, notices };
    return { text: rebuild(applyEdits(body, edits)), edits, notices, ...(moves.length === 0 ? {} : { moves }) };
  }

  /**
   * Records sections that kept their UIDs with IDs in another prefix, once their file is written:
   * the UID's entry moves to the new ID, and the old ID is retired under a UID no section holds,
   * so it is never reused (and an edited ID isn't put back to it).
   */
  private recordMoves(moves: readonly PrefixMove[] = []): void {
    for (const move of moves) {
      for (const prefixData of this.data.prefixes.values()) prefixData.sections.delete(move.uid);
      const prefix = move.id.slice(0, move.id.lastIndexOf("-"));
      let prefixData = this.data.prefixes.get(prefix);
      if (prefixData === undefined) {
        prefixData = emptyPrefixData();
        this.data.prefixes.set(prefix, prefixData);
      }
      prefixData.sections.set(move.uid, { id: move.id, documentId: move.documentId });
      if (move.oldId !== null) {
        const oldPrefix = move.oldId.slice(0, move.oldId.lastIndexOf("-"));
        this.data.prefixes.get(oldPrefix)?.retired.set(this.newUid(), { id: move.oldId });
      }
    }
  }

  /** Records a file just written and writes the data files. */
  private async written(config: FolderConfig, path: string, text: string, moves?: readonly PrefixMove[]): Promise<void> {
    this.recordMoves(moves);
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
      await this.written(config, path, anchored.text, anchored.moves);
      return SectionIndex.result(result, anchored);
    });
  }

  /**
   * Creates a file or folder; a sectioned file starts with its root anchor, with an ID in
   * `prefix` or else the folder's default prefix.
   */
  create(parent: string, name: string, kind: "file" | "folder", prefix?: string): Promise<string | null> {
    return this.run(async () => {
      const path = parent === "" ? name : `${parent}/${name}`;
      if (kind === "folder" || !(await this.load()).isSectioned(path)) return this.files.create(parent, name, kind);
      const config = await this.scanFiles();
      const content = rootAnchorText(this.nextId(prefix ?? config.prefixFor(path)!), this.newUid());
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
      for (const [documentId, path] of this.lastSeen) this.lastSeen.set(documentId, renamedPath(path, from, to) ?? path);
      await this.scanFiles();
      await this.dataFiles.write(this.data);
    });
  }

  /** Follows a deletion made through the file service and writes the data files. */
  deleted(path: string): Promise<void> {
    return this.run(async () => {
      for (const doc of [...this.documents.keys()]) if (isSameOrInside(doc, path)) this.documents.delete(doc);
      for (const [documentId, seen] of [...this.lastSeen]) if (isSameOrInside(seen, path)) this.lastSeen.delete(documentId);
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
          this.recordMoves(anchored.moves);
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
      await this.written(config, path, anchored.text, anchored.moves);
      return SectionIndex.result(result, anchored);
    });
  }

  /**
   * Renumbers a whole file as a copy of another document, at the user's request: every section
   * gets a new ID, the root section included, as a copy's do. The file is rewritten as a save
   * would, if it is still at `baseVersion`.
   */
  renumberDocument(path: string, baseVersion: string): Promise<SaveResult> {
    return this.run(async () => {
      const config = await this.scanFiles();
      const file = await this.files.readFile(path);
      if (file.version !== baseVersion) return { ok: false, reason: "conflict", version: file.version };
      if (!config.isSectioned(path)) return { ok: true, version: file.version };
      const anchored = this.anchor(config, path, file.text, false, [], [path]);
      const result = await this.files.saveFile(path, anchored.text, baseVersion);
      if (!result.ok) return result;
      await this.written(config, path, anchored.text, anchored.moves);
      return SectionIndex.result(result, anchored);
    });
  }

  /**
   * The problems in a folder's sectioned files: nested Specquer folders, whole files copied with
   * no known original, duplicates and collisions waiting for the user, unusable prefix settings
   * for the prefixes the folder holds, stray anchors, files with merge conflict markers, and
   * statuses that aren't allowed.
   */
  problems(folder: string): Promise<SectionProblem[]> {
    return this.run(async () => {
      const config = await this.scanFiles();
      const problems: SectionProblem[] = [];
      for (const nested of this.nested) {
        if (isSameOrInside(nested, folder)) problems.push({ kind: "nested-specquer", folder: nested });
      }
      for (const copied of this.copiedDocuments) {
        if (copied.paths.some((path) => isSameOrInside(path, folder))) problems.push({ kind: "copied-document", paths: copied.paths });
      }
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
      const docs = [...this.documents.values()].filter((doc) => isSameOrInside(doc.path, folder)).sort((a, b) => (a.path < b.path ? -1 : 1));
      const statuses = new Map(docs.map((doc) => [doc.path, this.statusesOf(doc.sections, config.prefixFor(doc.path))]));
      const held = new Set([...statuses.values()].flatMap((list) => list.flatMap((status) => (status.prefix === undefined ? [] : [status.prefix]))));
      for (const problem of this.prefixSettings.problems()) if (held.has(problem.prefix)) problems.push(problem);
      for (const doc of docs) {
        if (doc.frozen) problems.push({ kind: "conflict-markers", path: doc.path });
        for (const stray of doc.strays) problems.push({ kind: "stray", path: doc.path, id: stray.id, line: stray.line });
        statuses.get(doc.path)!.forEach((status, index) => {
          const section = doc.sections[index]!;
          // A placeholder is reported once it has its ID
          if (status.valid || section.id === null || status.prefix === undefined) return;
          problems.push({ kind: "invalid-status", path: doc.path, id: section.id, line: section.anchor?.line ?? 1, value: status.own ?? "", prefix: status.prefix });
        });
      }
      return problems;
    });
  }

  /**
   * A section by ID, after bringing the index up to date: its document's path, the document's
   * body (without front matter, `\n` line endings) and the section found in it. The first, if the
   * ID is duplicated.
   */
  find(id: string): Promise<{ path: string; body: string; section: FoundSection } | undefined> {
    return this.run(async () => {
      await this.scanFiles();
      for (const doc of this.documents.values()) {
        if (!doc.sections.some((section) => section.id === id)) continue;
        let text: string;
        try {
          text = (await this.files.readFile(doc.path)).text;
        } catch {
          return undefined;
        }
        const { body } = prepareText(text);
        const section = this.analyze(body).sections.find((found) => found.id === id);
        return section === undefined ? undefined : { path: doc.path, body, section };
      }
      return undefined;
    });
  }

  /** The status lists for a file's sections: whether it is sectioned, its folder's prefix and the allowed values. */
  statuses(path: string): Promise<SectionStatusLists> {
    return this.run(async () => {
      const config = await this.load();
      return { sectioned: config.isSectioned(path), folderPrefix: config.prefixFor(path) ?? null, statusValues: this.prefixSettings.statusValues() };
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
