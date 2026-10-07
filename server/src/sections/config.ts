import { join } from "node:path";
import { isMarkdownFile } from "@specquer/shared/paths";
import { isPrefix } from "@specquer/shared/sections";
import { parseDocument, isMap, isScalar } from "yaml";

/**
 * The prefix configuration, `.specquer/shared/section-prefixes.config.yaml`: globs on workspace
 * paths mapped to the prefix new sections get. Keys are checked from the last to the first, so
 * they are listed from least to most specific; a key ending in `/` matches that folder and
 * everything in it. Only Markdown files matching a key are sectioned; without the file, none is.
 */

export const SHARED_FOLDER = join(".specquer", "shared");
export const CONFIG_FILE = join(SHARED_FOLDER, "section-prefixes.config.yaml");

interface Rule {
  key: string;
  prefix: string;
  glob: Bun.Glob;
}

export class PrefixConfig {
  private readonly rules: Rule[];

  constructor(entries: ReadonlyArray<readonly [key: string, prefix: string]>) {
    this.rules = entries.map(([key, prefix]) => ({ key, prefix, glob: new Bun.Glob(key.endsWith("/") ? `${key}**` : key) }));
  }

  static readonly empty = new PrefixConfig([]);

  /** The prefix for new sections in a file, or `undefined` when the file isn't sectioned. */
  prefixFor(path: string): string | undefined {
    if (!isMarkdownFile(path)) return undefined;
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i]!;
      if (rule.glob.match(path)) return rule.prefix;
    }
    return undefined;
  }

  isSectioned(path: string): boolean {
    return this.prefixFor(path) !== undefined;
  }

  /** The prefixes the configuration names. */
  prefixes(): Set<string> {
    return new Set(this.rules.map((rule) => rule.prefix));
  }
}

/**
 * Parses the configuration. Key order is kept even for keys that look like numbers; entries
 * with an invalid prefix are reported through `warn` and ignored.
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
  for (const pair of prefixes.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
    const value = isScalar(pair.value) ? pair.value.value : undefined;
    if (key === undefined || key === "" || typeof value !== "string" || !isPrefix(value)) {
      warn(`${CONFIG_FILE}: ignoring '${key}': '${String(value)}' isn't a valid prefix`);
      continue;
    }
    entries.push([key, value]);
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
