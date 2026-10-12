import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SettingsSaveResult } from "@specquer/shared/api";
import { type Document, isCollection, parseDocument } from "yaml";
import { contentVersion, writeAtomically } from "../files.ts";

/**
 * A configuration file Specquer edits for the settings dialogs. Edits go through the `yaml`
 * package's document API, so comments, key order and keys Specquer doesn't know are kept. Saves
 * carry the version the dialog read, so a file changed on disk (a pull, an edit by hand) is never
 * overwritten, and a file that isn't valid YAML is never rewritten.
 */

export interface YamlFileContent {
  /** A hash of the content; `""` while the file doesn't exist. */
  version: string;
  /** The parsed document (empty while the file doesn't exist). */
  doc: Document;
  exists: boolean;
  /** The first YAML error, if the file can't be parsed. */
  error?: string;
}

/** The first line of a document's first error. */
function firstError(doc: Document): string | undefined {
  return doc.errors[0]?.message.split("\n")[0];
}

function isEmpty(doc: Document): boolean {
  return doc.contents === null || (isCollection(doc.contents) && doc.contents.items.length === 0);
}

/** Runs writes one at a time, across all the settings files. */
export class WriteQueue {
  private queue: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

export class YamlFile {
  constructor(
    private readonly root: string,
    /** The file's path in the root folder. */
    readonly path: string,
    private readonly queue: WriteQueue,
    /** A comment for the top of the file when Specquer creates it. */
    private readonly header: string,
    /** Runs before the file is first created (creating its folder's `.gitignore`, say). */
    private readonly prepare: (folder: string) => Promise<void> = async (folder) => {
      await mkdir(folder, { recursive: true });
    },
  ) {}

  private get absolute(): string {
    return join(this.root, this.path);
  }

  async read(): Promise<YamlFileContent> {
    const file = Bun.file(this.absolute);
    let bytes: Uint8Array;
    try {
      bytes = await file.bytes();
    } catch {
      return { version: "", doc: parseDocument(""), exists: false };
    }
    const doc = parseDocument(new TextDecoder().decode(bytes));
    const error = firstError(doc);
    return { version: contentVersion(bytes), doc, exists: true, ...(error === undefined ? {} : { error: `${this.path}: ${error}` }) };
  }

  /**
   * Applies `change` to the file's document and writes it, if `baseVersion` is still the file's
   * version and the content changed. `change` may answer an error message instead, and nothing
   * is written.
   */
  edit(baseVersion: string, change: (doc: Document) => string | void): Promise<SettingsSaveResult> {
    return this.queue.run(async () => {
      const current = await this.read();
      if (current.version !== baseVersion) return { ok: false, reason: "conflict", version: current.version };
      if (current.error !== undefined) return { ok: false, reason: "invalid", message: `${current.error}. Fix the file by hand first.` };
      const before = current.exists ? current.doc.toString() : "";
      const problem = change(current.doc);
      if (typeof problem === "string") return { ok: false, reason: "invalid", message: problem };
      if (!current.exists) {
        // Nothing to write: a file isn't created only to hold nothing
        if (isEmpty(current.doc)) return { ok: true, version: "" };
        current.doc.commentBefore = this.header;
      }
      const text = current.doc.toString();
      if (current.exists && text === before) return { ok: true, version: current.version };
      if (!current.exists) await this.prepare(dirname(this.absolute));
      const bytes = new TextEncoder().encode(text);
      await writeAtomically(this.absolute, bytes);
      return { ok: true, version: contentVersion(bytes) };
    });
  }
}
