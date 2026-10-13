import { dirname } from "node:path";
import type { FolderSettings, SettingsSaveResult } from "@specquer/shared/api";
import { FOLDER_CONFIG_FILE, type FolderSetting, isSectionedType } from "@specquer/shared/settings";
import { type YAMLMap, isMap, isScalar } from "yaml";
import type { FileService } from "../files.ts";
import { type FolderEntry, effectiveSettings, folderChain, folderConfigPath, parseFolderConfig } from "../sections/folder-config.ts";
import { type WriteQueue, YamlFile } from "./yaml-file.ts";

/**
 * Folders' `.specquer-config.yaml` files, as the folder settings and new folder dialogs read and
 * write them. Only `folderType` and `defaultPrefix` are changed, keeping other keys and comments;
 * a file left with no keys is deleted, and none is created to hold nothing. The file is reached
 * only through an existing folder inside the root, and never through a symbolic link.
 */

const HEADER = " Specquer's settings for this folder and the folders in it; a folder's own file overrides each key.";

const KEYS = ["folderType", "defaultPrefix"] as const;

/** Removes a key from a mapping; a comment above it stays, above the next key. */
function removeKeepingComment(map: YAMLMap, key: string): void {
  const index = map.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === key);
  if (index < 0) return;
  const [removed] = map.items.splice(index, 1);
  const comment = isScalar(removed!.key) ? removed!.key.commentBefore : undefined;
  const next = map.items[index]?.key;
  if (comment && isScalar(next)) next.commentBefore = next.commentBefore ? `${comment}\n${next.commentBefore}` : comment;
}

export class FolderSettingsFile {
  constructor(
    private readonly files: FileService,
    private readonly queue: WriteQueue,
  ) {}

  private async file(folder: string): Promise<YamlFile> {
    const target = await this.files.folderConfigFile(folder);
    return new YamlFile(dirname(target), FOLDER_CONFIG_FILE, this.queue, HEADER, async () => {}, true, folderConfigPath(folder));
  }

  /** A folder's own entry, read from disk; `undefined` when it has no file or the file can't be read. */
  private async entry(folder: string): Promise<FolderEntry | undefined> {
    try {
      const content = await (await this.file(folder)).read();
      return content.exists && content.error === undefined ? parseFolderConfig(content.doc.toString(), folderConfigPath(folder)) : undefined;
    } catch {
      return undefined;
    }
  }

  async read(folder: string): Promise<FolderSettings> {
    const content = await (await this.file(folder)).read();
    const own = content.exists && content.error === undefined ? parseFolderConfig(content.doc.toString(), folderConfigPath(folder)) : {};
    const above = new Map<string, FolderEntry | undefined>();
    for (const current of folderChain(folder).slice(1)) above.set(current, await this.entry(current));
    const inherited = folder === "" ? effectiveSettings("", () => undefined) : effectiveSettings(folderChain(folder)[1]!, (current) => above.get(current));
    return {
      path: folder,
      version: content.version,
      own: { folderType: own.folderType ?? "inherit", defaultPrefix: own.defaultPrefix ?? "inherit" },
      inherited,
      ...(content.error === undefined ? {} : { error: content.error }),
    };
  }

  /** Whether a folder is sectioned with these settings: a sectioned type and a prefix, own or inherited. */
  static isSectioned(settings: Pick<FolderSettings, "own" | "inherited">): boolean {
    const type = settings.own.folderType === "inherit" ? settings.inherited.folderType.value : settings.own.folderType;
    const prefix = settings.own.defaultPrefix === "inherit" ? settings.inherited.defaultPrefix.value : settings.own.defaultPrefix;
    return isSectionedType(type) && prefix !== null;
  }

  /** Sets or removes the folder's two keys, keeping every other key and comment. */
  async write(folder: string, setting: FolderSetting, baseVersion: string): Promise<SettingsSaveResult> {
    const file = await this.file(folder);
    return file.edit(baseVersion, (doc) => {
      if (doc.contents !== null && !isMap(doc.contents)) return `${folderConfigPath(folder)}: expected a mapping. Fix the file by hand first.`;
      for (const key of KEYS) {
        const value = setting[key];
        if (value === "inherit") {
          if (isMap(doc.contents)) removeKeepingComment(doc.contents, key);
        } else if (doc.contents === null) doc.contents = doc.createNode({ [key]: value });
        else {
          // Changing the scalar in place keeps a comment after it
          const node = doc.get(key, true);
          if (isScalar(node)) node.value = value;
          else doc.set(key, value);
        }
      }
    });
  }
}
