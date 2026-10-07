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
  /** The section's CUID2; `null` for a duplicate ID that is renumbered on the next save. */
  uid: string | null;
  kind: "root" | "heading" | "item";
  /** The heading text, the start of a list item's text, or the file name for a root section. */
  title: string;
  /** The heading level, for heading sections. */
  depth?: number;
}

export interface SectionSearchResult extends SectionInfo {
  /** The document's workspace path. */
  path: string;
}

export interface AnchorFolderResult {
  /** The sectioned files whose anchors change (or would, in a dry run). */
  files: string[];
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

export const anchorFolderSchema = z.object({
  /** The folder ("" for the root folder). */
  folder: workspacePathSchema,
  /** Only report the files that would change. */
  dryRun: z.boolean(),
});
