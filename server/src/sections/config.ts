import { join } from "node:path";
import { isMarkdownFile } from "@specquer/shared/paths";
import { isPrefix } from "@specquer/shared/sections";
import { parseDocument, isMap, isScalar } from "yaml";

/**
 * The prefix configuration, `.specquer/shared/section-prefixes.config.yaml`: workspace paths mapped
 * to the prefix new sections get. A key is a folder (ending in `/`), which covers everything in it,
 * or a Markdown file (ending in `.md`). The longest key that matches a file's path wins, whatever
 * the order of the keys. Only Markdown files matching a key are sectioned; without the file, none is.
 */

export const SHARED_FOLDER = join(".specquer", "shared");
export const CONFIG_FILE = join(SHARED_FOLDER, "section-prefixes.config.yaml");

interface Rule {
  key: string;
  prefix: string;
}

/**
 * A key as a workspace path: without leading `./`, or `undefined` when it isn't a folder ending in
 * `/` or a file ending in `.md`, has empty, `.` or `..` segments, or holds `*` or `?` (keys are no
 * longer globs). `./` alone is the root folder, the key `""`.
 */
export function normalizeKey(key: string): string | undefined {
  let path = key.trim();
  while (path.startsWith("./")) path = path.slice(2);
  const isFolder = path === "" || path.endsWith("/");
  if ((!isFolder && !isMarkdownFile(path)) || /[*?]/.test(path)) return undefined;
  const segments = (isFolder ? path.slice(0, -1) : path).split("/");
  if (path !== "" && segments.some((s) => s === "" || s === "." || s === "..")) return undefined;
  return path;
}

export class PrefixConfig {
  /** Longest key first, so the first match is the most specific. */
  private readonly rules: Rule[];
  private readonly prefixList: string[];

  constructor(entries: ReadonlyArray<readonly [key: string, prefix: string]>) {
    this.rules = entries.map(([key, prefix]) => ({ key, prefix })).sort((a, b) => b.key.length - a.key.length);
    this.prefixList = entries.map(([, prefix]) => prefix);
  }

  static readonly empty = new PrefixConfig([]);

  /** The prefix for new sections in a file, or `undefined` when the file isn't sectioned. */
  prefixFor(path: string): string | undefined {
    if (!isMarkdownFile(path)) return undefined;
    const rule = this.rules.find(({ key }) => (key === "" || key.endsWith("/") ? path.startsWith(key) : path === key));
    return rule?.prefix;
  }

  isSectioned(path: string): boolean {
    return this.prefixFor(path) !== undefined;
  }

  /** The prefixes the configuration names. */
  prefixes(): Set<string> {
    return new Set(this.prefixList);
  }
}

/**
 * Parses the configuration. Entries with an invalid key or prefix, and repeats of a key, are
 * reported through `warn` and ignored.
 */
export function parsePrefixConfig(text: string, warn: (message: string) => void = () => {}): PrefixConfig {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    warn(`${CONFIG_FILE}: ${doc.errors[0]!.message.split("\n")[0]}`);
    return PrefixConfig.empty;
  }
  const prefixes = doc.get("prefixes");
  if (prefixes === undefined || prefixes === null) return PrefixConfig.empty;
  if (!isMap(prefixes)) {
    warn(`${CONFIG_FILE}: 'prefixes' must be a mapping`);
    return PrefixConfig.empty;
  }
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const pair of prefixes.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
    const value = isScalar(pair.value) ? pair.value.value : undefined;
    const path = key === undefined ? undefined : normalizeKey(key);
    if (path === undefined) {
      warn(`${CONFIG_FILE}: ignoring '${key}': a key is a folder ending in '/' or a file ending in '.md', not a glob`);
      continue;
    }
    if (typeof value !== "string" || !isPrefix(value)) {
      warn(`${CONFIG_FILE}: ignoring '${key}': '${String(value)}' isn't a valid prefix`);
      continue;
    }
    if (seen.has(path)) {
      warn(`${CONFIG_FILE}: ignoring '${key}': the path is already configured`);
      continue;
    }
    seen.add(path);
    entries.push([path, value]);
  }
  return new PrefixConfig(entries);
}

/** Reads the configuration again only when the file's modification time changes. */
export class PrefixConfigFile {
  private config = PrefixConfig.empty;
  private stamp: number | null = null;

  constructor(
    private readonly root: string,
    private readonly warn: (message: string) => void = (message) => console.warn(`specquer: ${message}`),
  ) {}

  async load(): Promise<PrefixConfig> {
    const file = Bun.file(join(this.root, CONFIG_FILE));
    let stamp: number | null = null;
    try {
      stamp = (await file.stat()).mtimeMs;
    } catch {
      stamp = null;
    }
    if (stamp === this.stamp) return this.config;
    this.stamp = stamp;
    this.config = stamp === null ? PrefixConfig.empty : parsePrefixConfig(await file.text(), this.warn);
    return this.config;
  }
}
