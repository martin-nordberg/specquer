import { z } from "zod";

/**
 * Workspace paths: relative to the root folder, separated by `/`, with no leading or trailing
 * slash. The root folder itself is the empty string.
 */

/** Folder names that are never exposed or modified through the file API. */
export const PROTECTED_NAMES: ReadonlySet<string> = new Set([".git", ".specquer"]);

/** Longest name accepted for a file or folder (most file systems allow 255 bytes). */
export const MAX_NAME_LENGTH = 255;

/** The extension of the files Specquer shows and edits. */
export const MARKDOWN_EXTENSION = ".md";

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };
export type NameCheck = { ok: true } | { ok: false; reason: string };

// Control characters, which no sensible file name contains
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Checks one file or folder name, as typed in the rename dialog. */
export function checkName(name: string): NameCheck {
  if (name.length === 0) return { ok: false, reason: "The name can't be empty." };
  if (name.trim() !== name) return { ok: false, reason: "The name can't start or end with a space." };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: "The name is too long." };
  if (name === "." || name === "..") return { ok: false, reason: "The name can't be '.' or '..'." };
  if (/[/\\]/.test(name)) return { ok: false, reason: "The name can't contain '/' or '\\'." };
  if (CONTROL_CHARS.test(name)) return { ok: false, reason: "The name can't contain control characters." };
  if (PROTECTED_NAMES.has(name)) return { ok: false, reason: `The name '${name}' is reserved.` };
  return { ok: true };
}

/**
 * Normalizes and validates a workspace path: removes `./` segments, repeated slashes and a
 * trailing slash; rejects absolute paths, `..`, backslashes and protected folders.
 */
export function checkPath(path: string): PathCheck {
  if (path.includes("\\")) return { ok: false, reason: "Paths use '/' as the separator." };
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    return { ok: false, reason: "Paths must be relative to the root folder." };
  }
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  for (const segment of segments) {
    if (segment === "..") return { ok: false, reason: "Paths can't contain '..'." };
    if (CONTROL_CHARS.test(segment)) return { ok: false, reason: "Paths can't contain control characters." };
    if (PROTECTED_NAMES.has(segment)) return { ok: false, reason: `Paths can't include '${segment}'.` };
  }
  return { ok: true, path: segments.join("/") };
}

/** Normalizes a path, throwing if it is invalid. */
export function normalizePath(path: string): string {
  const check = checkPath(path);
  if (!check.ok) throw new Error(check.reason);
  return check.path;
}

export function isMarkdownFile(path: string): boolean {
  return path.toLowerCase().endsWith(MARKDOWN_EXTENSION) && baseName(path).length > MARKDOWN_EXTENSION.length;
}

/** The last segment of a path ("" for the root). */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The folder containing a path ("" for top-level entries and for the root). */
export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function joinPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/** The path segments ([] for the root). */
export function pathSegments(path: string): string[] {
  return path === "" ? [] : path.split("/");
}

/** Whether `path` is `folder` itself or lies inside it. */
export function isSameOrInside(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(`${folder}/`);
}

/**
 * Rewrites `path` for a rename of `from` to `to`: returns the new path when `path` is `from`
 * or lies inside it, and `undefined` otherwise.
 */
export function renamedPath(path: string, from: string, to: string): string | undefined {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return undefined;
}

/**
 * The relative link from one file to another (`../b/c.md`), or "" when they are the same file.
 */
export function relativePath(fromFile: string, toFile: string): string {
  if (fromFile === toFile) return "";
  const from = pathSegments(parentPath(fromFile));
  const to = pathSegments(toFile);
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}

/** A Zod schema for workspace paths; it outputs the normalized path. */
export const workspacePathSchema = z.string().transform((value, ctx) => {
  const check = checkPath(value);
  if (!check.ok) {
    ctx.addIssue({ code: "custom", message: check.reason });
    return z.NEVER;
  }
  return check.path;
});

/** A workspace path that must name a Markdown file. */
export const markdownPathSchema = workspacePathSchema.refine(isMarkdownFile, {
  message: "Only Markdown (.md) files can be opened.",
});

/** A workspace path that must not be the root folder. */
export const entryPathSchema = workspacePathSchema.refine((p) => p !== "", {
  message: "The root folder can't be changed.",
});

/** A Zod schema for a single file or folder name. */
export const entryNameSchema = z.string().superRefine((value, ctx) => {
  const check = checkName(value);
  if (!check.ok) ctx.addIssue({ code: "custom", message: check.reason });
});
