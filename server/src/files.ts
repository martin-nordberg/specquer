import { chmod, lstat, mkdir, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { ApiError, type DeletePreview, type FileContent, type SaveResult, type Tree, type TreeFolder } from "@specquer/shared/api";
import {
  MARKDOWN_EXTENSION,
  PROTECTED_NAMES,
  baseName,
  checkPath,
  isMarkdownFile,
  isProtectedName,
  joinPath,
  parentPath,
  pathSegments,
} from "@specquer/shared/paths";
import { isSidecarPath, sidecarPath } from "@specquer/shared/comments";
import { FOLDER_CONFIG_FILE } from "@specquer/shared/settings";
import { gitInfo, gitListedFiles, gitUncommitted, gitUntrackedFolders } from "./git.ts";
import { FILE_CALLS, mapLimit } from "./limit.ts";

/** Folders the tree never shows (besides the protected `.git` and `.specquer`). */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([...PROTECTED_NAMES, "node_modules"]);

/** The tree lists at most this many files (decision D9). */
export const MAX_TREE_FILES = 10_000;

/** Walks of the file system for the tree stop after this many entries. */
export const MAX_WALK_ENTRIES = 100_000;

/** The delete dialog lists at most this many files. */
export const MAX_PREVIEW_FILES = 500;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** How long the scan, the chat index and pre-filling reuse a listing, in milliseconds (Step 014, R9.2). */
export const LISTING_MAX_AGE = 2_000;

/**
 * One listing of the files under the root (Step 014, R9): every file the tree may show, and the
 * kinds the section index, comments and chat take from it. Shared by everything that needs it
 * until it may be stale.
 */
export interface Listing {
  /** Every listed file, sorted. */
  all: string[];
  /** The Markdown files, sorted. */
  markdown: string[];
  /** The folder configuration files (`.specquer-config.yaml`), sorted. */
  configs: string[];
  /** The comment sidecars, sorted. */
  sidecars: string[];
  /** Folders holding no files (only other such folders, if any). */
  emptyFolders: string[];
  /** Folders below the root holding a `.specquer` folder of their own, sorted. */
  nested: string[];
  /** Whether a walk of the file system stopped at its limit. */
  walkTruncated: boolean;
}

export interface FileServiceOptions {
  /** How long a listing is reused by default (tests use 0, so files they write show at once). */
  listingMaxAge?: number;
}

/** What a walk of the file system found for the tree. */
interface WalkResult {
  files: string[];
  emptyFolders: string[];
  entries: number;
  /** Folders below the root holding a `.specquer` folder of their own. */
  nested: Set<string>;
}

/** The folder holding a `.specquer` segment of a path relative to the root, if it isn't the root. */
function nestedSpecquerFolder(path: string): string | undefined {
  const segments = path.split("/");
  const index = segments.indexOf(".specquer");
  return index > 0 ? segments.slice(0, index).join("/") : undefined;
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR";
}

/** Checks a new file's name: Specquer creates only Markdown files. Throws an `ApiError` if not. */
export function checkNewFileName(name: string): void {
  if (!isMarkdownFile(name)) throw new ApiError(400, "invalid", `The name must end with '${MARKDOWN_EXTENSION}'.`);
}

/** Checks a file's new name: only Markdown files are renamed, and they keep their extension. */
export function checkRenamedFileName(path: string, newName: string): void {
  if (!isMarkdownFile(path)) throw new ApiError(400, "invalid", "Only Markdown files can be renamed.");
  const extension = path.slice(path.lastIndexOf("."));
  if (!newName.endsWith(extension) || newName.length <= extension.length) {
    throw new ApiError(400, "invalid", `The name must end with '${extension}'.`);
  }
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
  private readonly listingMaxAge: number;
  private cached: { listing: Promise<Listing>; startedAt: number } | null = null;
  /** How many times the files were listed, for tests (R9.5). */
  listings = 0;

  constructor(
    readonly root: string,
    options: FileServiceOptions = {},
  ) {
    this.listingMaxAge = options.listingMaxAge ?? LISTING_MAX_AGE;
  }

  /**
   * The listing of the files, reused while it is at most `maxAge` milliseconds old (by default
   * `LISTING_MAX_AGE`; 0 lists again, `Infinity` takes the last one whatever its age). Callers
   * at the same time share one listing.
   */
  listing(maxAge = this.listingMaxAge): Promise<Listing> {
    const cached = this.cached;
    if (cached !== null && Date.now() - cached.startedAt <= maxAge) return cached.listing;
    const entry = { listing: this.list(), startedAt: Date.now() };
    this.cached = entry;
    entry.listing.catch(() => {
      if (this.cached === entry) this.cached = null;
    });
    return entry.listing;
  }

  /** Lists the files again on the next call: Specquer created, renamed or deleted something. */
  invalidateListing(): void {
    this.cached = null;
  }

  /** The absolute path for a workspace path, checked again for safety. */
  private absolute(path: string): string {
    const check = checkPath(path);
    if (!check.ok || check.path !== path) throw new ApiError(400, "invalid", "Invalid path");
    return path === "" ? this.root : join(this.root, ...pathSegments(path));
  }

  private isInsideRoot(real: string): boolean {
    return real === this.root || real.startsWith(this.root + sep);
  }

  /**
   * Checks a real path: it must be inside the root, and not in a protected folder (`.git`,
   * `.specquer`, in any case), which a symbolic link inside the root could lead to.
   */
  private assertAllowed(real: string, path: string): void {
    if (!this.isInsideRoot(real)) throw new ApiError(403, "forbidden", `'${path}' is outside the root folder.`);
    if (relative(this.root, real).split(sep).some(isProtectedName)) throw new ApiError(403, "forbidden", `'${path}' is in a protected folder.`);
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
    this.assertAllowed(real, path);
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
    this.assertAllowed(realParent, path);
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
    this.assertAllowed(real, path);
    if (!(await stat(real)).isDirectory()) throw new ApiError(400, "not_a_folder", `'${path}' isn't a folder.`);
    return real;
  }

  /** Checks that a folder exists inside the root ("" is the root itself); throws an `ApiError` if not. */
  async assertFolder(path: string): Promise<void> {
    await this.existingFolder(path);
  }

  /**
   * The absolute path of a folder's configuration file, for reading and writing it: the folder
   * must exist with its real path inside the root, and the file must not be a symbolic link.
   */
  async folderConfigFile(folder: string): Promise<string> {
    const target = join(await this.existingFolder(folder), FOLDER_CONFIG_FILE);
    try {
      if ((await lstat(target)).isSymbolicLink()) {
        throw new ApiError(403, "forbidden", `'${joinPath(folder, FOLDER_CONFIG_FILE)}' is a symbolic link.`);
      }
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    return target;
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

  /** The tree, from a new listing, so changes made outside Specquer show on reload. */
  async getTree(): Promise<Tree> {
    const listing = await this.listing(0);
    const truncated = listing.markdown.length > MAX_TREE_FILES || listing.walkTruncated;
    // A folder holding only its configuration file still shows
    const folders = [...listing.emptyFolders, ...listing.configs.map(parentPath).filter((folder) => folder !== "")];
    return { root: buildTree(listing.markdown.slice(0, MAX_TREE_FILES), folders), truncated };
  }

  /** Every Markdown file the tree would show, sorted, without the tree's size limit. */
  async listMarkdownFiles(maxAge?: number): Promise<string[]> {
    return (await this.listing(maxAge)).markdown;
  }

  /**
   * Every Markdown file the tree would show and every folder configuration file
   * (`.specquer-config.yaml`) and comment sidecar in the folders it visits, sorted, without the
   * tree's size limit, and the folders below the root that hold a `.specquer` folder of their own
   * (`nested`, sorted).
   */
  async listFiles(maxAge?: number): Promise<{ markdown: string[]; configs: string[]; sidecars: string[]; nested: string[] }> {
    const { markdown, configs, sidecars, nested } = await this.listing(maxAge);
    return { markdown, configs, sidecars, nested };
  }

  private async list(): Promise<Listing> {
    this.listings++;
    const walked: WalkResult = { files: [], emptyFolders: [], entries: 0, nested: new Set() };
    const git = await gitListedFiles(this.root);
    let links = new Set<string>();
    if (git === null) await this.walk("", walked, true);
    else {
      // Git lists no empty folders, so walk the untracked ones for them
      walked.files = git.files;
      links = git.links;
      for (const folder of (await gitUntrackedFolders(this.root)) ?? []) {
        const check = checkPath(folder);
        if (!check.ok || check.path === "" || pathSegments(check.path).some((segment) => SKIPPED_FOLDERS.has(segment))) continue;
        await this.walk(check.path, walked, false);
      }
    }
    const all: string[] = [];
    for (const path of walked.files) {
      const nested = nestedSpecquerFolder(path);
      if (nested !== undefined) walked.nested.add(nested);
      const check = checkPath(path);
      if (!check.ok) continue;
      if (pathSegments(check.path).some((segment) => SKIPPED_FOLDERS.has(segment))) continue;
      all.push(check.path);
    }
    // A symbolic link Git tracks may lead to a folder, or nowhere
    const linked = all.filter((path) => links.has(path));
    const kinds = await mapLimit(linked, FILE_CALLS, (path) => this.kindOf(path));
    const notFiles = new Set(linked.filter((_, i) => kinds[i] !== "file"));
    const files = notFiles.size === 0 ? all : all.filter((path) => !notFiles.has(path));
    files.sort();
    return {
      all: files,
      markdown: files.filter(isMarkdownFile),
      configs: files.filter((path) => baseName(path) === FOLDER_CONFIG_FILE),
      sidecars: files.filter(isSidecarPath),
      emptyFolders: walked.emptyFolders,
      nested: [...walked.nested].sort(),
      walkTruncated: walked.entries > MAX_WALK_ENTRIES,
    };
  }

  /**
   * Walks a folder for the tree, collecting folders that hold no files (only other such folders,
   * if any) and, if `collectFiles` is set, the files. Returns whether the folder holds files.
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
      if (++result.entries > MAX_WALK_ENTRIES) return true;
      const path = joinPath(folder, entry.name);
      if (entry.isDirectory() && entry.name === ".specquer" && folder !== "") result.nested.add(folder);
      if (!entry.isDirectory() || SKIPPED_FOLDERS.has(entry.name)) {
        // A folder holding only its configuration file counts as empty, so the tree shows it
        if (entry.name !== FOLDER_CONFIG_FILE) holdsFiles = true;
        if (collectFiles && entry.isFile()) result.files.push(path);
      } else if (await this.walk(path, result, collectFiles)) holdsFiles = true;
    }
    if (!holdsFiles && folder !== "") result.emptyFolders.push(folder);
    return holdsFiles;
  }

  /** A file's modification time and size, or `undefined` if it isn't a file. */
  async fileStamp(path: string): Promise<{ mtimeMs: number; size: number } | undefined> {
    try {
      const info = await stat(this.absolute(path));
      return info.isFile() ? { mtimeMs: info.mtimeMs, size: info.size } : undefined;
    } catch {
      return undefined;
    }
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
   * Creates a Markdown file (empty, or with `content`) or an empty folder in `parent`. Returns
   * the new path, or `null` if the name is taken.
   */
  async create(parent: string, name: string, kind: "file" | "folder", content = ""): Promise<string | null> {
    const path = joinPath(parent, name);
    if (kind === "file") checkNewFileName(name);
    const target = join(await this.existingFolder(parent), name);
    try {
      if (kind === "folder") await mkdir(target);
      else await writeFile(target, content, { flag: "wx" });
      this.invalidateListing();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw err;
    }
    return path;
  }

  /** Renames a file or folder within its folder. Returns the new path, or `null` if the name is taken. */
  async rename(path: string, newName: string): Promise<string | null> {
    const { absolute, isFolder } = await this.existingEntry(path);
    if (!isFolder) checkRenamedFileName(path, newName);
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
    this.invalidateListing();
    return newPath;
  }

  /** A file's text, or `undefined` if it doesn't exist (for sidecars, which come and go). */
  async readTextIfExists(path: string): Promise<string | undefined> {
    try {
      return (await this.readFile(path)).text;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return undefined;
      throw err;
    }
  }

  /** Writes a file whose folder exists, creating or replacing it. */
  async writeText(path: string, text: string): Promise<void> {
    const folder = await this.existingFolder(parentPath(path));
    await writeAtomically(join(folder, baseName(path)), text);
    this.invalidateListing();
  }

  /** Removes a file, if it exists. */
  async removeFile(path: string): Promise<void> {
    try {
      const { absolute, isFolder } = await this.existingEntry(path);
      if (!isFolder) {
        await rm(absolute);
        this.invalidateListing();
      }
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }

  /** Moves a file to another name in the same folder, if it exists, replacing what is there. */
  async moveFile(from: string, to: string): Promise<void> {
    if (parentPath(from) !== parentPath(to)) throw new ApiError(400, "invalid", "Files are only moved within their folder.");
    let source;
    try {
      source = await this.existingEntry(from);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return;
      throw err;
    }
    if (!source.isFolder) {
      await rename(source.absolute, join(dirname(source.absolute), baseName(to)));
      this.invalidateListing();
    }
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
      files.push(path);
      // A document's comment sidecar is deleted with it (Step 012, R3.5)
      if (isMarkdownFile(path) && (await this.kindOf(sidecarPath(path))) === "file") files.push(sidecarPath(path));
      fileCount = files.length;
    }
    files.sort();
    const git = await gitInfo(this.root);
    const uncommitted = git === null ? null : (await gitUncommitted(this.root, git, path)).sort();
    return { path, kind: isFolder ? "folder" : "file", files, fileCount, uncommitted };
  }

  async deleteEntry(path: string): Promise<void> {
    const { absolute } = await this.existingEntry(path);
    await rm(absolute, { recursive: true });
    this.invalidateListing();
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
