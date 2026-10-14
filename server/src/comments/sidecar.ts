import { Document, Scalar, isScalar, parse, visit } from "yaml";
import { type StoredThread, checkSidecar } from "@specquer/shared/comments";
import type { SidecarProblem } from "@specquer/shared/api";
import { hasConflictMarkers } from "@specquer/shared/markdown";

/** A comment sidecar's text read: its threads, or why it can't be used (Step 012, R4.1). */
export type ParsedSidecar = { ok: true; threads: StoredThread[] } | { ok: false; problem: SidecarProblem; message: string };

export function parseSidecar(text: string): ParsedSidecar {
  if (hasConflictMarkers(text)) return { ok: false, problem: "conflict-markers", message: "It has merge conflict markers." };
  let value: unknown;
  try {
    value = parse(text);
  } catch (err) {
    return { ok: false, problem: "unparsable", message: `It isn't valid YAML: ${(err as Error).message.split("\n")[0]}` };
  }
  return checkSidecar(value);
}

const HEADER = "# Comment threads on the sections of the document beside this file; written by Specquer. Commit this file.\n";

/**
 * A sidecar's text: keys in a fixed order, optional ones only when set, and multi-line comment
 * text in block scalars, so diffs and merges stay line by line (decision D7).
 */
export function serializeSidecar(threads: readonly StoredThread[]): string {
  const ordered = threads.map((thread) => ({
    threadUid: thread.threadUid,
    sectionUid: thread.sectionUid,
    status: thread.status,
    ...(thread.statusChangedBy === undefined ? {} : { statusChangedBy: thread.statusChangedBy, statusChangedAt: thread.statusChangedAt }),
    comments: thread.comments.map((comment) => ({
      commentUid: comment.commentUid,
      createdBy: comment.createdBy,
      createdAt: comment.createdAt,
      ...(comment.updatedBy === undefined ? {} : { updatedBy: comment.updatedBy, updatedAt: comment.updatedAt }),
      text: comment.text,
    })),
  }));
  const document = new Document({ threads: ordered });
  // Times in quotes, as in the examples: YAML 1.1 readers would take them for dates
  visit(document, {
    Pair(_, pair) {
      if (isScalar(pair.key) && String(pair.key.value).endsWith("At") && isScalar(pair.value)) pair.value.type = Scalar.QUOTE_SINGLE;
    },
  });
  return HEADER + document.toString({ lineWidth: 0, blockQuote: "literal" });
}
