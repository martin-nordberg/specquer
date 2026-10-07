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
