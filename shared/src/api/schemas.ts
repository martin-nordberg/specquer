import { z } from "zod";
import { entryNameSchema, entryPathSchema, markdownPathSchema, workspacePathSchema } from "../paths/paths.ts";

/** A folder in the tree; it lists only folders that contain Markdown files, and `.md` files. */
export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

export interface TreeFile {
  kind: "file";
  name: string;
  path: string;
}

export type TreeNode = TreeFolder | TreeFile;

export interface Tree {
  root: TreeFolder;
  /** True when the folder held more files than the tree's size limit. */
  truncated: boolean;
}

export interface FileContent {
  path: string;
  text: string;
  /** A hash of the file's content; saves send it back to detect changes made on disk. */
  version: string;
}

export interface DeletePreview {
  path: string;
  kind: "file" | "folder";
  /** Every file that would be deleted, including files the tree doesn't show (up to a limit). */
  files: string[];
  /** Total number of files, which may exceed `files.length`. */
  fileCount: number;
  /**
   * Files not committed to Git (new, modified or ignored), or `null` when the root folder isn't
   * in a Git repository.
   */
  uncommitted: string[] | null;
}

/** A section of a document, for badge tooltips and link completion. */
export interface SectionInfo {
  id: string;
  /** The section's UID (its anchor's `data-uid`); `null` when it has none yet or is renumbered on the next save. */
  uid: string | null;
  kind: "root" | "heading" | "item";
  /** The heading text, the start of a list item's text, or the file name for a root section. */
  title: string;
  /** The heading level, for heading sections. */
  depth?: number;
  /** Set when the section's ID is also used elsewhere and the user hasn't decided yet. */
  problem?: {
    kind: "duplicate" | "collision";
    /** Whether this occurrence keeps the ID while the others wait. */
    keeps: boolean;
    /** The other occurrences. */
    others: Array<{ path: string; title: string }>;
  };
}

/** Why a save gave a section a new number. */
export type SectionRenumberReason = "copy" | "reused" | "unknown-prefix" | "duplicate" | "collision";

/** What a save changed beyond adding anchors, so the user can be told. */
export type SectionNotice =
  /** A copy, a reused retired ID, an unknown prefix, or a duplicate the user asked to renumber. */
  | { kind: "renumbered"; reason: SectionRenumberReason; id: string; newId: string; title: string }
  /** An edited ID: `id` was found, `newId` (the recorded ID) put back. */
  | { kind: "restored"; id: string; newId: string; title: string }
  /** A UID copied from another section was replaced. */
  | { kind: "uid-replaced"; id: string; title: string }
  /** The file holds merge conflict markers and was saved as sent, without anchoring. */
  | { kind: "not-anchored" };

/** Something about the section anchors that needs the user's attention. */
export type SectionProblem =
  | {
      kind: "duplicate" | "collision";
      id: string;
      occurrences: Array<{ path: string; uid: string | null; title: string; keeps: boolean }>;
    }
  /** An anchor with a section ID that isn't in a section's place. */
  | { kind: "stray"; path: string; id: string; line: number }
  /** A sectioned file with merge conflict markers, left alone until they are resolved. */
  | { kind: "conflict-markers"; path: string };

export interface SectionSearchResult extends SectionInfo {
  /** The document's workspace path. */
  path: string;
}

export interface AnchorFolderResult {
  /** The sectioned files whose anchors change (or would, in a dry run). */
  files: string[];
  /** Whether the root folder's `AGENTS.md` holds the section anchor rules for coding agents. */
  agentGuide: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

export const fileQuerySchema = z.object({ path: markdownPathSchema });

export const entryQuerySchema = z.object({ path: entryPathSchema });

export const saveFileSchema = z.object({
  text: z.string(),
  /** The version the edits were based on. */
  baseVersion: z.string(),
});

export const createSchema = z.object({
  /** The folder to create the entry in ("" for the root folder). */
  parent: workspacePathSchema,
  /** The new entry's name (not a path); a file's must end with `.md`. */
  name: entryNameSchema,
  kind: z.enum(["file", "folder"]),
});

export const renameSchema = z.object({
  path: entryPathSchema,
  /** The new name (not a path); a file must keep its extension. */
  newName: entryNameSchema,
});

/** Searching sections by ID or title, across documents or (with `path`) in one. */
export const sectionSearchSchema = z.object({
  q: z.string().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  path: markdownPathSchema.optional(),
});

export const sectionProblemsSchema = z.object({
  /** The folder ("" for the root folder). */
  folder: workspacePathSchema.default(""),
});

export const renumberSectionSchema = z.object({
  path: markdownPathSchema,
  /** The occurrence to renumber: its section ID and UID (`null` for none). */
  id: z.string().max(100),
  uid: z.string().max(100).nullable(),
  /** The version the user saw. */
  baseVersion: z.string(),
});

export const anchorFolderSchema = z.object({
  /** The folder ("" for the root folder). */
  folder: workspacePathSchema,
  /** Only report the files that would change. */
  dryRun: z.boolean(),
  /** Also add the section anchor rules for coding agents to the root folder's `AGENTS.md`. */
  addAgentGuide: z.boolean().default(false),
});
