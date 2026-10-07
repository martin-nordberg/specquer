import { chmod, lstat, mkdir, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { ApiError, type DeletePreview, type FileContent, type SaveResult, type Tree, type TreeFolder } from "@specquer/shared/api";
import {
  MARKDOWN_EXTENSION,
  PROTECTED_NAMES,
  baseName,
  checkPath,
  isMarkdownFile,
  joinPath,
  parentPath,
  pathSegments,
} from "@specquer/shared/paths";
import { gitInfo, gitMarkdownFiles, gitUncommitted, gitUntrackedFolders } from "./git.ts";

/** Folders the tree never shows (besides the protected `.git` and `.specquer`). */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([...PROTECTED_NAMES, "node_modules"]);

/** The tree lists at most this many files (decision D9). */
export const MAX_TREE_FILES = 10_000;

/** Walks of the file system for the tree stop after this many entries. */
export const MAX_WALK_ENTRIES = 100_000;

/** The delete dialog lists at most this many files. */
export const MAX_PREVIEW_FILES = 500;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** What a walk of the file system found for the tree. */
interface WalkResult {
  files: string[];
  emptyFolders: string[];
  entries: number;
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR";
}

export function contentVersion(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/**
 * File operations confined to the root folder. Paths are workspace paths, already validated by
 * the shared schemas; every operation also checks the real path (after symbolic links) so it
 * can't leave the root.
 */
export class FileService {
  constructor(readonly root: string) {}

  /** The absolute path for a workspace path, checked again for safety. */
  private absolute(path: string): string {
    const check = checkPath(path);
    if (!check.ok || check.path !== path) throw new ApiError(400, "invalid", "Invalid path");
    return path === "" ? this.root : join(this.root, ...pathSegments(path));
  }

  private isInsideRoot(real: string): boolean {
    return real === this.root || real.startsWith(this.root + sep);
  }

  /** An existing file's absolute path, following symbolic links, which must stay inside the root. */
  private async existingFile(path: string): Promise<string> {
    let real: string;
    try {
      real = await realpath(this.absolute(path));
    } catch (err) {
      if (isNotFound(err)) throw new ApiError(404, "not_found", `'${path}' doesn't exist.`);
      throw err;
    }
    if (!this.isInsideRoot(real)) throw new ApiError(403, "forbidden", `'${path}' is outside the root folder.`);
    if (!(await stat(real)).isFile()) throw new ApiError(400, "not_a_file", `'${path}' isn't a file.`);
    return real;
  }

  /**
   * An existing entry (file, folder or symbolic link itself) for rename and delete: its folder's
   * real path must be inside the root.
   */
  private async existingEntry(path: string): Promise<{ absolute: string; isFolder: boolean }> {
    const absolute = this.absolute(path);
    let realParent: string;
    let info;
    try {
      realParent = await realpath(dirname(absolute));
      info = await lstat(absolute);
    } catch (err) {
      if (isNotFound(err)) throw new ApiError(404, "not_found", `'${path}' doesn't exist.`);
      throw err;
    }
    if (!this.isInsideRoot(realParent)) throw new ApiError(403, "forbidden", `'${path}' is outside the root folder.`);
    return { absolute: join(realParent, baseName(path)), isFolder: info.isDirectory() };
  }

  /** An existing folder's real path, which must be inside the root ("" is the root itself). */
  private async existingFolder(path: string): Promise<string> {
    let real: string;
    try {
      real = await realpath(this.absolute(path));
    } catch (err) {
      if (isNotFound(err)) throw new ApiError(404, "not_found", `'${path}' doesn't exist.`);
      throw err;
    }
    if (!this.isInsideRoot(real)) throw new ApiError(403, "forbidden", `'${path}' is outside the root folder.`);
    if (!(await stat(real)).isDirectory()) throw new ApiError(400, "not_a_folder", `'${path}' isn't a folder.`);
    return real;
  }

  async kindOf(path: string): Promise<"file" | "folder" | undefined> {
    if (!checkPath(path).ok) return undefined;
    try {
      const info = await stat(this.absolute(path));
      return info.isDirectory() ? "folder" : info.isFile() ? "file" : undefined;
    } catch {
      return undefined;
    }
  }

  async getTree(): Promise<Tree> {
    const walked: WalkResult = { files: [], emptyFolders: [], entries: 0 };
    const gitFiles = await gitMarkdownFiles(this.root);
    if (gitFiles === null) await this.walk("", walked, true);
    else {
      // Git lists neither empty folders nor what is inside untracked ones, so walk those
      walked.files = gitFiles;
      for (const folder of (await gitUntrackedFolders(this.root)) ?? []) {
        const check = checkPath(folder);
        if (!check.ok || check.path === "" || pathSegments(check.path).some((segment) => SKIPPED_FOLDERS.has(segment))) continue;
        await this.walk(check.path, walked, false);
      }
    }
    const files: string[] = [];
    for (const path of walked.files) {
      const check = checkPath(path);
      if (!check.ok || !isMarkdownFile(check.path)) continue;
      if (pathSegments(check.path).some((segment) => SKIPPED_FOLDERS.has(segment))) continue;
      // Git lists tracked files that were deleted from disk
      if ((await this.kindOf(check.path)) !== "file") continue;
      files.push(check.path);
    }
    files.sort();
    const truncated = files.length > MAX_TREE_FILES || walked.entries > MAX_WALK_ENTRIES;
    return { root: buildTree(files.slice(0, MAX_TREE_FILES), walked.emptyFolders), truncated };
  }

  /**
   * Walks a folder for the tree, collecting folders that hold no files (only other such folders,
   * if any) and, if `collectFiles` is set, Markdown files. Returns whether the folder holds files.
   */
  private async walk(folder: string, result: WalkResult, collectFiles: boolean): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(this.absolute(folder), { withFileTypes: true });
    } catch (err) {
      if (isNotFound(err)) return true;
      throw err;
    }
    let holdsFiles = false;
    for (const entry of entries) {
      if (++result.entries > MAX_WALK_ENTRIES || result.files.length > MAX_TREE_FILES) return true;
      const path = joinPath(folder, entry.name);
      if (!entry.isDirectory() || SKIPPED_FOLDERS.has(entry.name)) {
        holdsFiles = true;
        if (collectFiles && entry.isFile() && isMarkdownFile(path)) result.files.push(path);
      } else if (await this.walk(path, result, collectFiles)) holdsFiles = true;
    }
    if (!holdsFiles && folder !== "") result.emptyFolders.push(folder);
    return holdsFiles;
  }

  async readFile(path: string): Promise<FileContent> {
    const bytes = await Bun.file(await this.existingFile(path)).bytes();
    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      throw new ApiError(415, "not_utf8", `'${path}' isn't UTF-8 text.`);
    }
    return { path, text, version: contentVersion(bytes) };
  }

  /** Saves a file if it hasn't changed on disk since `baseVersion` (decision D8). */
  async saveFile(path: string, text: string, baseVersion: string): Promise<SaveResult> {
    const real = await this.existingFile(path);
    const current = contentVersion(await Bun.file(real).bytes());
    if (current !== baseVersion) return { ok: false, reason: "conflict", version: current };
    const bytes = new TextEncoder().encode(text);
    await writeAtomically(real, bytes);
    return { ok: true, version: contentVersion(bytes) };
  }

  /**
   * Creates an empty Markdown file or an empty folder in `parent`. Returns the new path, or
   * `null` if the name is taken.
   */
  async create(parent: string, name: string, kind: "file" | "folder"): Promise<string | null> {
    const path = joinPath(parent, name);
    if (kind === "file" && !isMarkdownFile(path)) {
      throw new ApiError(400, "invalid", `The name must end with '${MARKDOWN_EXTENSION}'.`);
    }
    const target = join(await this.existingFolder(parent), name);
    try {
      if (kind === "folder") await mkdir(target);
      else await writeFile(target, "", { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw err;
    }
    return path;
  }

  /** Renames a file or folder within its folder. Returns the new path, or `null` if the name is taken. */
  async rename(path: string, newName: string): Promise<string | null> {
    const { absolute, isFolder } = await this.existingEntry(path);
    if (!isFolder) {
      if (!isMarkdownFile(path)) throw new ApiError(400, "invalid", "Only Markdown files can be renamed.");
      const extension = path.slice(path.lastIndexOf("."));
      if (!newName.endsWith(extension) || newName.length <= extension.length) {
        throw new ApiError(400, "invalid", `The name must end with '${extension}'.`);
      }
    }
    const newPath = joinPath(parentPath(path), newName);
    if (newPath === path) return newPath;
    const target = join(dirname(absolute), newName);
    try {
      const [source, existing] = await Promise.all([lstat(absolute), lstat(target)]);
      // On case-insensitive file systems a case-only rename finds the source itself
      if (source.ino !== existing.ino || source.dev !== existing.dev) return null;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    await rename(absolute, target);
    return newPath;
  }

  async deletePreview(path: string): Promise<DeletePreview> {
    const { absolute, isFolder } = await this.existingEntry(path);
    const files: string[] = [];
    let fileCount = 0;
    const walk = async (folder: string, rel: string) => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const entryRel = joinPath(rel, entry.name);
        if (entry.isDirectory()) await walk(join(folder, entry.name), entryRel);
        else {
          fileCount++;
          if (files.length < MAX_PREVIEW_FILES) files.push(entryRel);
        }
      }
    };
    if (isFolder) await walk(absolute, path);
    else {
      fileCount = 1;
      files.push(path);
    }
    files.sort();
    const git = await gitInfo(this.root);
    const uncommitted = git === null ? null : (await gitUncommitted(this.root, git, path)).sort();
    return { path, kind: isFolder ? "folder" : "file", files, fileCount, uncommitted };
  }

  async deleteEntry(path: string): Promise<void> {
    const { absolute } = await this.existingEntry(path);
    await rm(absolute, { recursive: true });
  }
}

/** Builds the folder tree from sorted file paths and empty folders; folders come before files. */
export function buildTree(files: string[], emptyFolders: string[] = []): TreeFolder {
  const root: TreeFolder = { kind: "folder", name: "", path: "", children: [] };
  const folders = new Map<string, TreeFolder>([["", root]]);
  const folderFor = (path: string): TreeFolder => {
    let folder = folders.get(path);
    if (folder === undefined) {
      folder = { kind: "folder", name: baseName(path), path, children: [] };
      folders.set(path, folder);
      folderFor(parentPath(path)).children.push(folder);
    }
    return folder;
  };
  for (const folder of emptyFolders) folderFor(folder);
  for (const file of files) folderFor(parentPath(file)).children.push({ kind: "file", name: baseName(file), path: file });
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  for (const folder of folders.values()) {
    folder.children.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === "folder" ? -1 : 1));
  }
  return root;
}

/** Writes to a temporary file in the same folder, then renames it over the target. */
export async function writeAtomically(target: string, data: Uint8Array | string): Promise<void> {
  const temp = join(dirname(target), `.${target.slice(target.lastIndexOf(sep) + 1)}.${crypto.randomUUID()}.tmp`);
  try {
    await Bun.write(temp, data);
    try {
      await chmod(temp, (await stat(target)).mode & 0o7777);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}
