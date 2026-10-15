import { init } from "@paralleldrive/cuid2";
import type { SectionProblem } from "@specquer/shared/api";
import {
  type CommentChange,
  type CommentChangeRefusal,
  type CommentChangeResult,
  type CommentsResponse,
  type StoredThread,
  commentVersion,
  documentOfSidecar,
  firstLine,
  sidecarPath,
  threadView,
} from "@specquer/shared/comments";
import { isMarkdownFile, isSameOrInside } from "@specquer/shared/paths";
import { UID_LENGTH } from "@specquer/shared/sections";
import type { FileService } from "../files.ts";
import { gitUserName } from "../git.ts";
import type { SectionIndex } from "../sections/section-index.ts";
import { WriteQueue } from "../settings/yaml-file.ts";
import { type ParsedSidecar, parseSidecar, serializeSidecar } from "./sidecar.ts";

export interface CommentServiceOptions {
  newUid?: () => string;
  /** The name recorded for the user (default: from Git, read at most once a minute). */
  userName?: () => Promise<string>;
  now?: () => Date;
}

/** How long the user's name from Git is kept before it is read again. */
const USER_NAME_TTL = 60_000;

const refusals: Record<CommentChangeRefusal, string> = {
  conflict: "The comment was changed on disk since it was loaded; your change wasn't saved.",
  resolved: "The thread is resolved; reopen it first.",
  "has-replies": "A thread's first comment can only be deleted with the thread while it has replies.",
  "not-found": "The section, thread or comment is no longer there.",
  empty: "A comment needs some text.",
  unusable: "The comment file can't be used; see Section problems.",
  unavailable: "This file can't have comment threads.",
};

/** UTC to the second, as the sidecars hold it. */
function timestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Comment threads (Step 012): read and changed in each document's sidecar. A change is applied by
 * its UIDs to the sidecar as it is on disk at that moment (decision D1), so changes to other
 * threads made on disk meanwhile (a Git pull) are kept; only an edit to a comment that changed
 * since it was loaded is refused. Changes are made one at a time.
 */
export class CommentService {
  private readonly queue = new WriteQueue();
  private readonly newUid: () => string;
  private readonly userName: () => Promise<string>;
  private readonly now: () => Date;

  constructor(
    private readonly files: FileService,
    private readonly sections: SectionIndex,
    options: CommentServiceOptions = {},
  ) {
    this.newUid = options.newUid ?? init({ length: UID_LENGTH });
    this.now = options.now ?? (() => new Date());
    let cached: { name: string; at: number } | null = null;
    this.userName =
      options.userName ??
      (async () => {
        if (cached === null || Date.now() - cached.at > USER_NAME_TTL) cached = { name: await gitUserName(files.root), at: Date.now() };
        return cached.name;
      });
  }

  private async read(path: string): Promise<ParsedSidecar | null> {
    const text = await this.files.readTextIfExists(sidecarPath(path));
    return text === undefined ? null : parseSidecar(text);
  }

  private async available(path: string): Promise<boolean> {
    return (await this.files.kindOf(path)) === "file" && (await this.sections.statuses(path)).sectioned;
  }

  /** A document's threads, as on disk. */
  async threads(path: string): Promise<CommentsResponse> {
    const available = await this.available(path);
    const parsed = await this.read(path);
    if (parsed === null) return { available, threads: [] };
    if (!parsed.ok) return { available, threads: [], unusable: parsed.message };
    return { available, threads: parsed.threads.map(threadView) };
  }

  /** Applies one change to a document's sidecar, and returns its threads as they are now. */
  change(path: string, change: CommentChange): Promise<CommentChangeResult> {
    return this.queue.run(async () => {
      const parsed = await this.read(path);
      const current = parsed?.ok === true ? parsed.threads : [];
      const refuse = (reason: CommentChangeRefusal): CommentChangeResult => ({ ok: false, reason, threads: current.map(threadView), message: refusals[reason] });
      if (!(await this.available(path))) return refuse("unavailable");
      if (parsed !== null && !parsed.ok) return refuse("unusable");
      const threads = structuredClone(current);
      const user = await this.userName();
      const at = timestamp(this.now());
      const thread = "threadUid" in change ? threads.find((t) => t.threadUid === change.threadUid) : undefined;
      if ("threadUid" in change && thread === undefined) return refuse("not-found");
      let created: { threadUid: string; commentUid: string } | undefined;

      switch (change.op) {
        case "add-thread": {
          if (change.text.trim() === "") return refuse("empty");
          const uids = new Set((await this.sections.sectionsOf(path)).map((section) => section.uid));
          if (!uids.has(change.sectionUid)) return refuse("not-found");
          created = { threadUid: this.newUid(), commentUid: this.newUid() };
          threads.push({
            threadUid: created.threadUid,
            sectionUid: change.sectionUid,
            status: "Open",
            comments: [{ commentUid: created.commentUid, createdBy: user, createdAt: at, text: change.text }],
          });
          break;
        }
        case "reply": {
          if (thread!.status === "Resolved") return refuse("resolved");
          if (change.text.trim() === "") return refuse("empty");
          created = { threadUid: thread!.threadUid, commentUid: this.newUid() };
          thread!.comments.push({ commentUid: created.commentUid, createdBy: user, createdAt: at, text: change.text });
          break;
        }
        case "edit": {
          const comment = thread!.comments.find((c) => c.commentUid === change.commentUid);
          if (comment === undefined) return refuse("not-found");
          if (thread!.status === "Resolved") return refuse("resolved");
          if (commentVersion(comment) !== change.baseVersion) return refuse("conflict");
          if (change.text.trim() === "") return refuse("empty");
          if (change.text === comment.text) return { ok: true, threads: current.map(threadView) };
          comment.text = change.text;
          comment.updatedBy = user;
          comment.updatedAt = at;
          break;
        }
        case "delete-comment": {
          const index = thread!.comments.findIndex((c) => c.commentUid === change.commentUid);
          if (index < 0) return refuse("not-found");
          if (thread!.status === "Resolved") return refuse("resolved");
          if (index === 0 && thread!.comments.length > 1) return refuse("has-replies");
          if (thread!.comments.length === 1) threads.splice(threads.indexOf(thread!), 1);
          else thread!.comments.splice(index, 1);
          break;
        }
        case "set-status": {
          if (thread!.status === change.status) return { ok: true, threads: current.map(threadView) };
          thread!.status = change.status;
          thread!.statusChangedBy = user;
          thread!.statusChangedAt = at;
          break;
        }
        case "delete-thread":
          threads.splice(threads.indexOf(thread!), 1);
          break;
      }
      await this.write(path, threads);
      return { ok: true, threads: threads.map(threadView), ...(created === undefined ? {} : { created }) };
    });
  }

  private async write(path: string, threads: StoredThread[]): Promise<void> {
    // No threads, no sidecar (R3.4)
    if (threads.length === 0) await this.files.removeFile(sidecarPath(path));
    else await this.files.writeText(sidecarPath(path), serializeSidecar(threads));
  }

  /** A document was renamed: its sidecar follows (R3.5). */
  renamed(from: string, to: string): Promise<void> {
    return this.queue.run(() => this.files.moveFile(sidecarPath(from), sidecarPath(to)));
  }

  /** A document was deleted: so is its sidecar (R3.5). */
  deleted(path: string): Promise<void> {
    return this.queue.run(() => this.files.removeFile(sidecarPath(path)));
  }

  /**
   * A document is about to be created, or renamed, at `path`: a leftover sidecar there goes first
   * (R3.6). Only a Markdown path has a sidecar; anything else is left alone.
   */
  beforeCreate(path: string): Promise<void> {
    return this.queue.run(async () => {
      if (!isMarkdownFile(path)) return;
      if ((await this.files.kindOf(path)) === undefined) await this.files.removeFile(sidecarPath(path));
    });
  }

  /** Unusable and orphaned sidecars, and detached threads, in a folder (R4). */
  async problems(folder: string): Promise<SectionProblem[]> {
    const { markdown, sidecars } = await this.files.listFiles();
    const documents = new Set(markdown);
    const problems: SectionProblem[] = [];
    for (const path of sidecars) {
      if (!isSameOrInside(path, folder)) continue;
      const document = documentOfSidecar(path);
      if (!documents.has(document)) {
        problems.push({ kind: "orphaned-sidecar", path });
        continue;
      }
      const parsed = await this.read(document);
      if (parsed === null) continue;
      if (!parsed.ok) {
        problems.push({ kind: "comment-sidecar", path, problem: parsed.problem, message: parsed.message });
        continue;
      }
      if (!(await this.sections.statuses(document)).sectioned) continue;
      const uids = new Set((await this.sections.sectionsOf(document)).map((section) => section.uid));
      for (const thread of parsed.threads) {
        if (uids.has(thread.sectionUid)) continue;
        problems.push({ kind: "detached-thread", path: document, threadUid: thread.threadUid, sectionUid: thread.sectionUid, text: firstLine(thread.comments[0]!.text) });
      }
    }
    return problems;
  }
}
