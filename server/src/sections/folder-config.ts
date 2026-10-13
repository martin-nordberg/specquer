import { join } from "node:path";
import { isMarkdownFile, parentPath, pathSegments } from "@specquer/shared/paths";
import { isPrefix } from "@specquer/shared/sections";
import { FOLDER_CONFIG_FILE, FOLDER_TYPES, type FolderType, isSectionedType } from "@specquer/shared/settings";
import { isMap, parseDocument } from "yaml";

/**
 * The folder configuration: a `.specquer-config.yaml` in each folder that needs one, holding
 * the folder's `folderType` and `defaultPrefix`. Each key is inherited separately from the
 * nearest folder at or above a folder that sets it, so a subfolder can change only its prefix.
 * A folder with no `folderType` at or above it isn't sectioned, nor is a sectioned type with no
 * `defaultPrefix`. Other keys in the file are kept by the writers and ignored here.
 *
 * Only the folders the tree listing visits are searched (the same Git-ignore rules; never
 * `.git` or `node_modules`), and each file is read again only when its modification time changes.
 */

/** A folder's own settings, as its file holds them. */
export interface FolderEntry {
  folderType?: FolderType;
  defaultPrefix?: string;
}

/** A value in effect for a folder, and the folder that sets it (`null`: none does). */
export interface EffectiveValue<T> {
  value: T | null;
  from: string | null;
}

export interface EffectiveSettings {
  folderType: EffectiveValue<FolderType>;
  defaultPrefix: EffectiveValue<string>;
}

/** The workspace path of a folder's configuration file. */
export function folderConfigPath(folder: string): string {
  return folder === "" ? FOLDER_CONFIG_FILE : `${folder}/${FOLDER_CONFIG_FILE}`;
}

/** The folder a configuration file configures, or `undefined` when the path isn't one. */
export function configFolder(path: string): string | undefined {
  return pathSegments(path).at(-1) === FOLDER_CONFIG_FILE ? parentPath(path) : undefined;
}

/** The folder and the folders above it, nearest first, ending with the root folder (""). */
export function folderChain(folder: string): string[] {
  const chain: string[] = [];
  let current = folder;
  for (;;) {
    chain.push(current);
    if (current === "") return chain;
    current = parentPath(current);
  }
}

/** Parses a folder's file. Invalid values are reported through `warn` and ignored. */
export function parseFolderConfig(text: string, path: string, warn: (message: string) => void = () => {}): FolderEntry {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    warn(`${path}: ${doc.errors[0]!.message.split("\n")[0]}; ignoring the file`);
    return {};
  }
  if (doc.contents === null) return {};
  if (!isMap(doc.contents)) {
    warn(`${path}: expected a mapping; ignoring the file`);
    return {};
  }
  const entry: FolderEntry = {};
  const folderType = doc.get("folderType");
  if (folderType !== undefined && folderType !== null) {
    if (typeof folderType === "string" && (FOLDER_TYPES as readonly string[]).includes(folderType)) entry.folderType = folderType as FolderType;
    else warn(`${path}: ignoring folderType '${String(folderType)}': expected one of ${FOLDER_TYPES.join(", ")}`);
  }
  const defaultPrefix = doc.get("defaultPrefix");
  if (defaultPrefix !== undefined && defaultPrefix !== null) {
    if (typeof defaultPrefix === "string" && isPrefix(defaultPrefix)) entry.defaultPrefix = defaultPrefix;
    else warn(`${path}: ignoring defaultPrefix '${String(defaultPrefix)}': it isn't a valid prefix`);
  }
  return entry;
}

/** What a folder's settings come to, given its own entry and the entries above it. */
export function effectiveSettings(folder: string, entryOf: (folder: string) => FolderEntry | undefined): EffectiveSettings {
  const result: EffectiveSettings = { folderType: { value: null, from: null }, defaultPrefix: { value: null, from: null } };
  for (const current of folderChain(folder)) {
    const entry = entryOf(current);
    if (entry === undefined) continue;
    if (result.folderType.from === null && entry.folderType !== undefined) result.folderType = { value: entry.folderType, from: current };
    if (result.defaultPrefix.from === null && entry.defaultPrefix !== undefined) result.defaultPrefix = { value: entry.defaultPrefix, from: current };
  }
  return result;
}

/** The parsed folder files, by folder. Immutable; `FolderConfigs` makes a new one on changes. */
export class FolderConfig {
  private readonly cache = new Map<string, string | undefined>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly entries: ReadonlyMap<string, FolderEntry>,
    private readonly warn: (message: string) => void = () => {},
  ) {}

  static readonly empty = new FolderConfig(new Map());

  own(folder: string): FolderEntry | undefined {
    return this.entries.get(folder);
  }

  effective(folder: string): EffectiveSettings {
    return effectiveSettings(folder, (current) => this.entries.get(current));
  }

  /** A folder's default prefix when it is sectioned, or `undefined` when it isn't. */
  folderPrefix(folder: string): string | undefined {
    if (this.cache.has(folder)) return this.cache.get(folder);
    const { folderType, defaultPrefix } = this.effective(folder);
    let prefix: string | undefined;
    if (isSectionedType(folderType.value)) {
      if (defaultPrefix.value !== null) prefix = defaultPrefix.value;
      else if (!this.warned.has(folderType.from!)) {
        this.warned.add(folderType.from!);
        this.warn(`${folderConfigPath(folderType.from!)}: a ${folderType.value} folder needs a defaultPrefix; its files aren't sectioned`);
      }
    }
    this.cache.set(folder, prefix);
    return prefix;
  }

  /** The prefix for a Markdown file's root section, or `undefined` when the file isn't sectioned. */
  prefixFor(path: string): string | undefined {
    return isMarkdownFile(path) ? this.folderPrefix(parentPath(path)) : undefined;
  }

  isSectioned(path: string): boolean {
    return this.prefixFor(path) !== undefined;
  }

  /** The default prefixes the files name. */
  prefixes(): Set<string> {
    return new Set([...this.entries.values()].flatMap((entry) => (entry.defaultPrefix === undefined ? [] : [entry.defaultPrefix])));
  }
}

/**
 * Reads the folder files the tree listing found, each again only when its modification time
 * changes. The listing comes from `list` on the first load and after `invalidate()`, and from
 * every scan through `setFiles`, so a file added by hand counts from the next scan.
 */
export class FolderConfigs {
  private files: string[] | null = null;
  private readonly read = new Map<string, { mtimeMs: number; entry: FolderEntry }>();
  private config = FolderConfig.empty;
  private dirty = true;

  constructor(
    private readonly root: string,
    private readonly list: () => Promise<string[]>,
    private readonly warn: (message: string) => void = (message) => console.warn(`specquer: ${message}`),
  ) {}

  /** The folder files found by a listing of the tree. */
  setFiles(paths: readonly string[]): void {
    this.files = [...paths];
  }

  async load(): Promise<FolderConfig> {
    if (this.files === null) this.files = await this.list();
    let changed = false;
    const wanted = new Set(this.files);
    for (const path of [...this.read.keys()]) {
      if (wanted.has(path)) continue;
      this.read.delete(path);
      changed = true;
    }
    for (const path of this.files) {
      const file = Bun.file(join(this.root, ...pathSegments(path)));
      let mtimeMs: number;
      try {
        mtimeMs = (await file.stat()).mtimeMs;
      } catch {
        if (this.read.delete(path)) changed = true;
        continue;
      }
      if (this.read.get(path)?.mtimeMs === mtimeMs) continue;
      let text = "";
      try {
        text = await file.text();
      } catch {
        this.warn(`${path} is unreadable; ignoring it`);
      }
      this.read.set(path, { mtimeMs, entry: parseFolderConfig(text, path, this.warn) });
      changed = true;
    }
    if (changed || this.dirty) {
      this.dirty = false;
      const entries = new Map<string, FolderEntry>();
      for (const [path, { entry }] of this.read) entries.set(configFolder(path)!, entry);
      this.config = new FolderConfig(entries, this.warn);
    }
    return this.config;
  }

  /** Lists and reads the files again on the next load, after Specquer wrote or deleted one. */
  invalidate(): void {
    this.files = null;
    this.read.clear();
    this.dirty = true;
  }
}
