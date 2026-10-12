import type { FolderSettings, SettingsSaveResult } from "@specquer/shared/api";
import type { FolderSetting } from "@specquer/shared/settings";
import { type Pair, Scalar, isMap, isScalar } from "yaml";
import { CONFIG_FILE, folderKey, normalizeKey, parsePrefixConfig } from "../sections/config.ts";
import { type WriteQueue, YamlFile } from "./yaml-file.ts";

/**
 * Folders' entries in the prefix configuration, as the folder settings dialog reads and writes
 * them. A folder's key is found whatever its spelling (`./documentation/` or `documentation/`);
 * a new key is the folder path with its trailing `/`, or `./` for the root folder.
 */

const HEADER = " Section prefixes by folder or file: the longest matching key wins; null leaves files unsectioned.";

/** The folder a folder key stands for ("" for the root folder). */
const keyFolder = (key: string) => (key === "" ? "" : key.slice(0, -1));

export class FolderSettingsFile {
  private readonly file: YamlFile;

  constructor(root: string, queue: WriteQueue) {
    this.file = new YamlFile(root, CONFIG_FILE, queue, HEADER);
  }

  async read(folder: string): Promise<FolderSettings> {
    const content = await this.file.read();
    const config = parsePrefixConfig(content.error === undefined && content.exists ? content.doc.toString() : "");
    const entry = config.entryFor(folder);
    const inherited = config.inheritedFor(folder);
    return {
      path: folder,
      version: content.version,
      own: entry === undefined ? { kind: "inherit" } : entry === null ? { kind: "off" } : { kind: "prefix", prefix: entry },
      inherited: inherited === undefined ? null : { from: keyFolder(inherited.key), prefix: inherited.prefix },
      fileKeys: config.fileKeysIn(folder).map(({ key, prefix }) => ({ path: key, prefix })),
      ...(content.error === undefined ? {} : { error: content.error }),
    };
  }

  /** Sets, clears or removes the folder's entry, keeping every other entry and comment. */
  write(folder: string, setting: FolderSetting, baseVersion: string): Promise<SettingsSaveResult> {
    const key = folderKey(folder);
    return this.file.edit(baseVersion, (doc) => {
      if (doc.contents !== null && !isMap(doc.contents)) return `${CONFIG_FILE}: expected a mapping. Fix the file by hand first.`;
      let prefixes = doc.get("prefixes", true);
      if (prefixes === undefined || prefixes === null || (isScalar(prefixes) && prefixes.value === null)) {
        if (setting.kind === "inherit") return;
        prefixes = doc.createNode({});
        doc.set("prefixes", prefixes);
      }
      if (!isMap(prefixes)) return `${CONFIG_FILE}: 'prefixes' must be a mapping. Fix the file by hand first.`;
      const matches = (pair: Pair) => isScalar(pair.key) && normalizeKey(String(pair.key.value)) === key;
      if (setting.kind === "inherit") {
        prefixes.items = prefixes.items.filter((pair) => !matches(pair));
        return;
      }
      const value = setting.kind === "off" ? null : setting.prefix;
      const pair = prefixes.items.find(matches);
      if (pair !== undefined) {
        // Changing the scalar in place keeps a comment after it
        if (isScalar(pair.value)) pair.value.value = value;
        else pair.value = doc.createNode(value);
        return;
      }
      const newKey = new Scalar(key === "" ? "./" : key);
      newKey.type = Scalar.QUOTE_DOUBLE;
      prefixes.items.push(doc.createPair(newKey, value));
    });
  }
}
