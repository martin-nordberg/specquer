import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PrefixConfigProblem } from "@specquer/shared/api";
import { DEFAULT_STATUS_VALUES, isPrefix } from "@specquer/shared/sections";
import { PREFIX_CONFIG_FILE } from "@specquer/shared/settings";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { SHARED_FOLDER } from "./data.ts";

/**
 * The prefixes' own settings: `.specquer/shared/<prefix>/prefix.config.yaml`, next to the
 * prefix's `sections.yaml`, hand-edited and committed. For now it holds the allowed statuses:
 *
 * ```yaml
 * statusValues:
 *   - Draft
 *   - Approved
 * ```
 *
 * A file that can't be used (it doesn't parse, has no list or an empty one, a blank or repeated
 * value) leaves its prefix on the default statuses and is reported as a section problem. Each
 * file is read again when its modification time or size changes.
 */

/** Why a prefix's file can't be used. */
export type PrefixConfigReason = PrefixConfigProblem["problem"];

export type ParsedPrefixConfig = { statusValues: string[] } | { problem: PrefixConfigReason; message: string };

/** Parses a prefix's file: its statuses (trimmed), or why they can't be used. */
export function parsePrefixConfig(text: string): ParsedPrefixConfig {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { problem: "unparsable", message: `it doesn't parse (${doc.errors[0]!.message.split("\n")[0]})` };
  const list = isMap(doc.contents) ? doc.contents.get("statusValues", true) : undefined;
  if (!isSeq(list)) return { problem: "missing-list", message: "it has no list of statusValues" };
  if (list.items.length === 0) return { problem: "empty-list", message: "its list of statusValues is empty" };
  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of list.items) {
    const value = isScalar(item) && typeof item.value === "string" ? item.value.trim() : undefined;
    if (value === undefined || value === "" || value.includes('"')) {
      const shown = isScalar(item) ? String(item.value) : String(item);
      return { problem: "bad-value", message: `"${shown}" isn't a status (it must be text, not blank, without ")` };
    }
    if (seen.has(value.toLowerCase())) return { problem: "repeated-value", message: `"${value}" is listed twice` };
    seen.add(value.toLowerCase());
    values.push(value);
  }
  return { statusValues: values };
}

/** The workspace path of a prefix's file. */
export function prefixConfigPath(prefix: string): string {
  return [...SHARED_FOLDER.split(/[\\/]/), prefix, PREFIX_CONFIG_FILE].join("/");
}

/** The prefixes' settings as read. Immutable; `PrefixConfigs` makes a new one on changes. */
export class PrefixSettings {
  constructor(private readonly parsed: ReadonlyMap<string, ParsedPrefixConfig>) {}

  static readonly empty = new PrefixSettings(new Map());

  /** A prefix's allowed statuses: its file's, or the defaults. */
  allowed(prefix: string | undefined): readonly string[] {
    const parsed = prefix === undefined ? undefined : this.parsed.get(prefix);
    return parsed !== undefined && "statusValues" in parsed ? parsed.statusValues : DEFAULT_STATUS_VALUES;
  }

  /** The lists of the prefixes with a usable file. */
  statusValues(): Record<string, string[]> {
    const lists: Record<string, string[]> = {};
    for (const [prefix, parsed] of this.parsed) if ("statusValues" in parsed) lists[prefix] = [...parsed.statusValues];
    return lists;
  }

  /** The files that can't be used, by prefix. */
  problems(): PrefixConfigProblem[] {
    return [...this.parsed]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .flatMap(([prefix, parsed]) =>
        "problem" in parsed ? [{ kind: "prefix-config" as const, prefix, path: prefixConfigPath(prefix), problem: parsed.problem, message: parsed.message }] : [],
      );
  }
}

/** Reads the prefixes' files under the root folder, each again only when it changes. */
export class PrefixConfigs {
  private readonly folder: string;
  private readonly read = new Map<string, { stamp: string; parsed: ParsedPrefixConfig }>();
  private settings = PrefixSettings.empty;

  constructor(
    root: string,
    private readonly warn: (message: string) => void = (message) => console.warn(`specquer: ${message}`),
  ) {
    this.folder = join(root, SHARED_FOLDER);
  }

  private async prefixFolders(): Promise<string[]> {
    try {
      return (await readdir(this.folder, { withFileTypes: true })).filter((e) => e.isDirectory() && isPrefix(e.name)).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async load(): Promise<PrefixSettings> {
    let changed = false;
    const found = new Set<string>();
    for (const prefix of await this.prefixFolders()) {
      const file = join(this.folder, prefix, PREFIX_CONFIG_FILE);
      let stamp: string;
      try {
        const info = await stat(file);
        stamp = `${info.mtimeMs}:${info.size}`;
      } catch {
        continue;
      }
      found.add(prefix);
      if (this.read.get(prefix)?.stamp === stamp) continue;
      let parsed: ParsedPrefixConfig;
      try {
        parsed = parsePrefixConfig(await Bun.file(file).text());
      } catch {
        parsed = { problem: "unparsable", message: "it can't be read" };
      }
      if ("problem" in parsed) this.warn(`${prefixConfigPath(prefix)}: ${parsed.message}; ${prefix} uses the default statuses`);
      this.read.set(prefix, { stamp, parsed });
      changed = true;
    }
    for (const prefix of [...this.read.keys()]) {
      if (found.has(prefix)) continue;
      this.read.delete(prefix);
      changed = true;
    }
    if (changed) this.settings = new PrefixSettings(new Map([...this.read].map(([prefix, { parsed }]) => [prefix, parsed])));
    return this.settings;
  }
}
