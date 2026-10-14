import { z } from "zod";
import { isUid } from "../sections/uids.ts";

/**
 * Comment threads (Step 012): conversations about sections, kept in a sidecar file next to each
 * document (`a.md` → `a.md.comments.yaml`). A thread belongs to one section by its UID; its
 * comments are Markdown. Specquer issues thread and comment UIDs in the form of section UIDs.
 */

export const SIDECAR_SUFFIX = ".comments.yaml";

/** A comment's text is at most this long. */
export const MAX_COMMENT_LENGTH = 20_000;

/** The sidecar of a Markdown document. */
export function sidecarPath(documentPath: string): string {
  return `${documentPath}${SIDECAR_SUFFIX}`;
}

/** Whether a path names a comment sidecar (`*.md.comments.yaml`). */
export function isSidecarPath(path: string): boolean {
  return /[^/]\.md\.comments\.yaml$/i.test(path) && path.endsWith(SIDECAR_SUFFIX);
}

/** The document a sidecar belongs to. */
export function documentOfSidecar(path: string): string {
  return path.slice(0, -SIDECAR_SUFFIX.length);
}

const uidSchema = z.string().refine(isUid, { message: "Not a UID." });
/** An ISO 8601 time in UTC, as Specquer writes it (`2026-10-10T12:22:59Z`), optionally with milliseconds. */
const timeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, { message: "Not a UTC time." });
const nameSchema = z.string().min(1);

export const threadStatuses = ["Open", "Resolved"] as const;
export const threadStatusSchema = z.enum(threadStatuses);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const storedCommentSchema = z.object({
  commentUid: uidSchema,
  createdBy: nameSchema,
  createdAt: timeSchema,
  updatedBy: nameSchema.optional(),
  updatedAt: timeSchema.optional(),
  text: z.string(),
});
export type StoredComment = z.infer<typeof storedCommentSchema>;

export const storedThreadSchema = z.object({
  threadUid: uidSchema,
  sectionUid: uidSchema,
  status: threadStatusSchema,
  statusChangedBy: nameSchema.optional(),
  statusChangedAt: timeSchema.optional(),
  comments: z.array(storedCommentSchema).min(1),
});
export type StoredThread = z.infer<typeof storedThreadSchema>;

export const sidecarSchema = z.object({ threads: z.array(storedThreadSchema) });
export type Sidecar = z.infer<typeof sidecarSchema>;

export type SidecarCheck = { ok: true; threads: StoredThread[] } | { ok: false; problem: "format" | "unknown-status" | "repeated-uid"; message: string };

/** Checks a parsed sidecar: the format, then what the schema can't say (repeated UIDs, half-recorded changes). */
export function checkSidecar(value: unknown): SidecarCheck {
  // An empty file is a sidecar without threads
  const parsed = sidecarSchema.safeParse(value ?? { threads: [] });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.join(".");
    const unknownStatus = issue.path.at(-1) === "status" && issue.code === "invalid_value";
    return {
      ok: false,
      problem: unknownStatus ? "unknown-status" : "format",
      message: unknownStatus ? `${where}: the status must be Open or Resolved.` : `${where === "" ? "" : `${where}: `}${issue.message}`,
    };
  }
  const seen = new Set<string>();
  for (const [t, thread] of parsed.data.threads.entries()) {
    if ((thread.statusChangedBy === undefined) !== (thread.statusChangedAt === undefined)) {
      return { ok: false, problem: "format", message: `threads.${t}: statusChangedBy and statusChangedAt go together.` };
    }
    for (const uid of [thread.threadUid, ...thread.comments.map((comment) => comment.commentUid)]) {
      if (seen.has(uid)) return { ok: false, problem: "repeated-uid", message: `The UID ${uid} is used more than once.` };
      seen.add(uid);
    }
    for (const [c, comment] of thread.comments.entries()) {
      if ((comment.updatedBy === undefined) !== (comment.updatedAt === undefined)) {
        return { ok: false, problem: "format", message: `threads.${t}.comments.${c}: updatedBy and updatedAt go together.` };
      }
    }
  }
  return { ok: true, threads: parsed.data.threads };
}

/**
 * A comment's version: a short hash of what an edit could have changed, so an edit made to an
 * older version is refused (R3.3).
 */
export function commentVersion(comment: StoredComment): string {
  const text = `${comment.updatedAt ?? comment.createdAt}\u0000${comment.text}`;
  // FNV-1a, 32 bits
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The first line of a comment with text, without Markdown's leading marks, for previews. */
export function firstLine(text: string, max = 120): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  const plain = line.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)*/, "").trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export interface CommentView extends StoredComment {
  version: string;
}

export interface ThreadView extends Omit<StoredThread, "comments"> {
  comments: CommentView[];
}

export function threadView(thread: StoredThread): ThreadView {
  return { ...thread, comments: thread.comments.map((comment) => ({ ...comment, version: commentVersion(comment) })) };
}

export interface CommentsResponse {
  /** False for a file that can't have threads (not in a sectioned folder). */
  available: boolean;
  threads: ThreadView[];
  /** Why the sidecar can't be used, when it can't; its threads aren't shown. */
  unusable?: string;
}

const textSchema = z.string().max(MAX_COMMENT_LENGTH);

export const commentChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add-thread"), sectionUid: uidSchema, text: textSchema }),
  z.object({ op: z.literal("reply"), threadUid: uidSchema, text: textSchema }),
  z.object({ op: z.literal("edit"), threadUid: uidSchema, commentUid: uidSchema, text: textSchema, baseVersion: z.string() }),
  z.object({ op: z.literal("delete-comment"), threadUid: uidSchema, commentUid: uidSchema }),
  z.object({ op: z.literal("set-status"), threadUid: uidSchema, status: threadStatusSchema }),
  z.object({ op: z.literal("delete-thread"), threadUid: uidSchema }),
]);
export type CommentChange = z.infer<typeof commentChangeSchema>;

export type CommentChangeRefusal = "conflict" | "resolved" | "has-replies" | "not-found" | "empty" | "unusable" | "unavailable";

/** The threads on disk after a change, whether or not it was made. */
export type CommentChangeResult =
  | { ok: true; threads: ThreadView[]; created?: { threadUid: string; commentUid: string } }
  | { ok: false; reason: CommentChangeRefusal; threads: ThreadView[]; message: string };

export const commentFilters = ["open", "resolved", "all"] as const;
export const commentFilterSchema = z.enum(commentFilters);
export type CommentFilter = z.infer<typeof commentFilterSchema>;

/** Whether the filter shows a thread with this status. */
export function shownBy(filter: CommentFilter, status: ThreadStatus): boolean {
  return filter === "all" || (filter === "open") === (status === "Open");
}
