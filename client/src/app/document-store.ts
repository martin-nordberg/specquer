import {
  type FrontmatterLayout,
  applyEdits,
  detectEol,
  fromLf,
  joinFrontmatter,
  splitFrontmatter,
  toLf,
} from "@specquer/shared/markdown";
import type { SectionNotice } from "@specquer/shared/api";
import type { Api, SaveOutcome } from "@/lib/api";
import { rebaseEdits } from "./edits";

/**
 * The open file: one in-memory copy, split into front matter and body, shared by all editors.
 * Editors work with `\n` line endings; saving restores the file's own line endings.
 */
export interface OpenDocument {
  path: string;
  /** The front matter without delimiters, or `null` when the file has none. */
  frontmatter: string | null;
  body: string;
  /** Whether the file had front matter when it was opened (sets the editor's initial height). */
  openedWithFrontmatter: boolean;
  /** Increases when the content is replaced from outside the editors (a reload), so they remount. */
  revision: number;
  /**
   * Increases when the body is changed from outside the editors without a reload: anchors the
   * server added on save. The text editor applies such changes in place.
   */
  externalEdits: number;
}

export type SaveStatus = "saved" | "unsaved" | "saving" | "conflict" | "error";

export interface DocumentState {
  document: OpenDocument | null;
  status: SaveStatus;
  /** Set when a save found the file changed on disk; holds the version on disk. */
  conflict: { theirVersion: string } | null;
  error: string | null;
  /** What the last save or renumbering changed beyond adding anchors, until dismissed. */
  notices: SectionNotice[];
  /** The version of the file on disk, as last read or written. */
  version: string;
}

export type SaveResult = "clean" | "saved" | "conflict" | "error";

/** Autosave interval while there are unsaved changes. */
export const AUTOSAVE_INTERVAL = 60_000;

export class DocumentStore {
  private state: DocumentState = { document: null, status: "saved", conflict: null, error: null, notices: [], version: "" };
  private listeners = new Set<() => void>();
  /** The file's text as last read or written, byte for byte. */
  private savedText = "";
  private version = "";
  private layout: FrontmatterLayout | null = null;
  private eol: "\n" | "\r\n" = "\n";
  /** Whether the user has changed anything since the last save. */
  private edited = false;
  private saving: Promise<SaveResult> | null = null;

  constructor(private readonly api: Api) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = () => this.state;

  get hasUnsavedChanges(): boolean {
    return this.edited;
  }

  private set(update: Partial<DocumentState>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }

  private load(path: string, text: string, version: string, revision: number) {
    const split = splitFrontmatter(text);
    this.savedText = text;
    this.version = version;
    this.layout = split.layout;
    this.eol = split.frontmatter === null ? detectEol(text) : split.layout.eol;
    this.edited = false;
    this.set({
      document: {
        path,
        frontmatter: split.frontmatter === null ? null : toLf(split.frontmatter),
        body: toLf(split.body),
        openedWithFrontmatter: split.frontmatter !== null,
        revision,
        externalEdits: 0,
      },
      status: "saved",
      conflict: null,
      error: null,
      notices: [],
      version,
    });
  }

  /** Opens a file. The caller saves the current one first. */
  async open(path: string): Promise<void> {
    const file = await this.api.readFile(path);
    this.load(path, file.text, file.version, (this.state.document?.revision ?? 0) + 1);
  }

  close(): void {
    this.edited = false;
    this.set({ document: null, status: "saved", conflict: null, error: null, notices: [] });
  }

  /** Follows a rename of the open file (or a folder containing it). */
  moved(path: string): void {
    if (this.state.document !== null) this.set({ document: { ...this.state.document, path } });
  }

  setFrontmatter(text: string): void {
    // Clearing the editor removes the front matter block
    this.change({ frontmatter: text === "" ? null : text });
  }

  setBody(body: string): void {
    this.change({ body });
  }

  private change(update: Partial<OpenDocument>): void {
    const document = this.state.document;
    if (document === null) return;
    if (Object.entries(update).every(([key, value]) => document[key as keyof OpenDocument] === value)) return;
    this.edited = true;
    this.set({ document: { ...document, ...update }, status: this.state.conflict ? "conflict" : "unsaved" });
  }

  /** The file text the editors currently hold. */
  text(): string {
    const document = this.state.document;
    if (document === null || this.layout === null) return this.savedText;
    return this.textFor(document.frontmatter, document.body);
  }

  private textFor(frontmatter: string | null, body: string): string {
    const layout = { ...this.layout!, eol: "\n" as const };
    return fromLf(joinFrontmatter(frontmatter, body, layout), this.eol);
  }

  /**
   * Saves if there are changes. Returns "conflict" (and holds off further saves) when the file
   * changed on disk since it was read.
   */
  save(options?: { keepalive?: boolean }): Promise<SaveResult> {
    if (this.saving !== null) return this.saving.then(() => this.save(options));
    if (this.state.conflict !== null) return Promise.resolve("conflict");
    this.saving = this.write(this.version, options).finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  private async write(baseVersion: string, options?: { keepalive?: boolean }): Promise<SaveResult> {
    const document = this.state.document;
    if (document === null || !this.edited) return "clean";
    const text = this.text();
    if (text === this.savedText) {
      this.edited = false;
      this.set({ status: "saved" });
      return "clean";
    }
    this.set({ status: "saving" });
    try {
      const outcome = await this.api.saveFile(document.path, text, baseVersion, options);
      if (this.state.document?.path !== document.path) return "saved";
      if (outcome.kind === "conflict") {
        this.set({ status: "conflict", conflict: { theirVersion: outcome.version } });
        return "conflict";
      }
      this.savedText = text;
      this.saved(document.frontmatter, document.body, outcome);
      return "saved";
    } catch (err) {
      this.set({ status: "error", error: (err as Error).message });
      return "error";
    }
  }

  /**
   * Takes a successful write: what the server wrote (the `body` sent, with its edits) becomes the
   * saved text, and the editors get the edits, mapped through anything typed while the request
   * was under way.
   */
  private saved(frontmatter: string | null, body: string, outcome: Extract<SaveOutcome, { kind: "saved" }>): void {
    this.version = outcome.version;
    const edits = outcome.edits ?? [];
    if (edits.length > 0) {
      this.savedText = this.textFor(frontmatter, applyEdits(body, edits));
      const current = this.state.document!;
      this.set({ document: { ...current, body: rebaseEdits(body, current.body, edits), externalEdits: current.externalEdits + 1 } });
    }
    // Edits made while the request was under way are still unsaved
    this.edited = this.text() !== this.savedText;
    this.set({
      status: this.edited ? "unsaved" : "saved",
      error: null,
      version: outcome.version,
      ...(outcome.notices === undefined ? {} : { notices: outcome.notices }),
    });
  }

  dismissNotices(): void {
    if (this.state.notices.length > 0) this.set({ notices: [] });
  }

  /**
   * Gives one occurrence of a duplicate ID in the open file a new number, saving first. The
   * server rewrites the file; the editors get its edits.
   */
  async renumber(id: string, uid: string | null): Promise<SaveResult> {
    const saved = await this.save();
    if (saved === "conflict" || saved === "error") return saved;
    const document = this.state.document;
    if (document === null) return "clean";
    // What is on disk now, as the editors hold it
    const disk = splitFrontmatter(toLf(this.savedText));
    try {
      const outcome = await this.api.renumberSection(document.path, id, uid, this.version);
      if (this.state.document?.path !== document.path) return "saved";
      if (outcome.kind === "conflict") {
        this.set({ status: "conflict", conflict: { theirVersion: outcome.version } });
        return "conflict";
      }
      this.saved(disk.frontmatter, toLf(disk.body), outcome);
      return "saved";
    } catch (err) {
      this.set({ status: "error", error: (err as Error).message });
      return "error";
    }
  }

  /** Resolves a conflict by replacing the user's changes with the file on disk. */
  async reloadTheirs(): Promise<void> {
    const document = this.state.document;
    if (document === null) return;
    const file = await this.api.readFile(document.path);
    this.load(document.path, file.text, file.version, document.revision + 1);
  }

  /** Resolves a conflict by overwriting the file on disk with the user's version. */
  async keepMine(): Promise<SaveResult> {
    const conflict = this.state.conflict;
    if (conflict === null) return this.save();
    this.set({ conflict: null });
    return this.write(conflict.theirVersion);
  }
}
