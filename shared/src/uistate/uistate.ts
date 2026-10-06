import { z } from "zod";
import { isSameOrInside, renamedPath } from "../paths/paths.ts";

/**
 * The user's UI state, kept in `.specquer/user/uistate.yaml`. The client reads and changes it;
 * the server stores it. Every update is a pure function, so both sides apply the same rules.
 *
 * Paths are workspace paths (relative to the root, separated by `/`).
 */

export const UI_STATE_VERSION = 1;
export const MAX_RECENT_FILES = 10;
export const MIN_TREE_PANE_FRACTION = 0.1;
export const MAX_TREE_PANE_FRACTION = 0.7;
export const DEFAULT_TREE_PANE_FRACTION = 0.25;

export const viewTypes = ["text", "split", "preview", "wysiwyg"] as const;
export const viewTypeSchema = z.enum(viewTypes);
export type ViewType = z.infer<typeof viewTypeSchema>;

export const themeSchema = z.enum(["light", "dark"]);
export type Theme = z.infer<typeof themeSchema>;

export const fileUiStateSchema = z.object({
  viewType: viewTypeSchema.catch("text"),
  /** Height of the front matter editor in pixels (the drag bar position). */
  frontmatterHeight: z.number().positive().optional().catch(undefined),
});
export type FileUiState = z.infer<typeof fileUiStateSchema>;

const pathListSchema = z
  .array(z.unknown())
  .transform((items) => [...new Set(items.filter((item): item is string => typeof item === "string"))]);

/**
 * The stored form. Each field falls back to its default on its own, so damaged or unknown
 * content never stops Specquer from starting.
 */
export const uiStateSchema = z.object({
  version: z.literal(UI_STATE_VERSION).catch(UI_STATE_VERSION),
  /** Absent until the user chooses; until then the browser's preference applies. */
  theme: themeSchema.optional().catch(undefined),
  /** Width of the tree pane as a fraction of the window. */
  treePaneFraction: z
    .number()
    .min(MIN_TREE_PANE_FRACTION)
    .max(MAX_TREE_PANE_FRACTION)
    .catch(DEFAULT_TREE_PANE_FRACTION),
  expandedFolders: pathListSchema.catch([]),
  /** Most recent first, excluding the current file. */
  recentFiles: pathListSchema.transform((paths) => paths.slice(0, MAX_RECENT_FILES)).catch([]),
  currentFile: z.string().optional().catch(undefined),
  files: z
    .record(z.string(), z.unknown())
    .transform((files) => {
      const result: Record<string, FileUiState> = {};
      for (const [path, value] of Object.entries(files)) {
        const parsed = fileUiStateSchema.safeParse(value);
        if (parsed.success) result[path] = parsed.data;
      }
      return result;
    })
    .catch({}),
});
export type UiState = z.output<typeof uiStateSchema>;

/** A partial update sent by the client; the server merges it into the stored state. */
export const uiStatePatchSchema = z
  .object({
    theme: themeSchema.nullable(),
    treePaneFraction: z.number().min(MIN_TREE_PANE_FRACTION).max(MAX_TREE_PANE_FRACTION),
    expandedFolders: z.array(z.string()),
    recentFiles: z.array(z.string()).max(MAX_RECENT_FILES),
    currentFile: z.string().nullable(),
    files: z.record(z.string(), fileUiStateSchema),
  })
  .partial();
export type UiStatePatch = z.infer<typeof uiStatePatchSchema>;

export function defaultUiState(): UiState {
  return {
    version: UI_STATE_VERSION,
    treePaneFraction: DEFAULT_TREE_PANE_FRACTION,
    expandedFolders: [],
    recentFiles: [],
    files: {},
  };
}

/** Parses stored content, replacing anything invalid with defaults. */
export function parseUiState(value: unknown): UiState {
  const parsed = uiStateSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : defaultUiState();
}

/** Applies a patch; `null` clears an optional field. */
export function applyUiStatePatch(state: UiState, patch: UiStatePatch): UiState {
  const { theme, currentFile, ...rest } = patch;
  const next: UiState = { ...state, ...rest };
  if (theme !== undefined) next.theme = theme ?? undefined;
  if (currentFile !== undefined) next.currentFile = currentFile ?? undefined;
  return parseUiState(next);
}

/** The patch that turns `from` into `to` (top-level fields that changed). */
export function diffUiState(from: UiState, to: UiState): UiStatePatch {
  const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const patch: UiStatePatch = {};
  if (from.theme !== to.theme) patch.theme = to.theme ?? null;
  if (from.treePaneFraction !== to.treePaneFraction) patch.treePaneFraction = to.treePaneFraction;
  if (!same(from.expandedFolders, to.expandedFolders)) patch.expandedFolders = to.expandedFolders;
  if (!same(from.recentFiles, to.recentFiles)) patch.recentFiles = to.recentFiles;
  if (from.currentFile !== to.currentFile) patch.currentFile = to.currentFile ?? null;
  if (!same(from.files, to.files)) patch.files = to.files;
  return patch;
}

/** Opens a file: the previous current file moves to the front of the recent files. */
export function openFile(state: UiState, path: string): UiState {
  if (state.currentFile === path) return state;
  const previous = state.currentFile;
  const recent = [...(previous === undefined ? [] : [previous]), ...state.recentFiles].filter(
    (p, i, all) => p !== path && all.indexOf(p) === i,
  );
  return { ...state, currentFile: path, recentFiles: recent.slice(0, MAX_RECENT_FILES) };
}

/** Closes the current file without opening another (it joins the recent files). */
export function closeFile(state: UiState): UiState {
  if (state.currentFile === undefined) return state;
  const recent = [state.currentFile, ...state.recentFiles.filter((p) => p !== state.currentFile)];
  return { ...state, currentFile: undefined, recentFiles: recent.slice(0, MAX_RECENT_FILES) };
}

export function fileUiState(state: UiState, path: string): FileUiState {
  return state.files[path] ?? { viewType: "text" };
}

export function updateFileUiState(state: UiState, path: string, update: Partial<FileUiState>): UiState {
  return { ...state, files: { ...state.files, [path]: { ...fileUiState(state, path), ...update } } };
}

export function setViewType(state: UiState, path: string, viewType: ViewType): UiState {
  return updateFileUiState(state, path, { viewType });
}

export function setFrontmatterHeight(state: UiState, path: string, height: number): UiState {
  return updateFileUiState(state, path, { frontmatterHeight: Math.max(1, Math.round(height)) });
}

export function setTheme(state: UiState, theme: Theme | undefined): UiState {
  return { ...state, theme };
}

export function clampTreePaneFraction(fraction: number): number {
  return Math.min(MAX_TREE_PANE_FRACTION, Math.max(MIN_TREE_PANE_FRACTION, fraction));
}

export function setTreePaneFraction(state: UiState, fraction: number): UiState {
  return { ...state, treePaneFraction: clampTreePaneFraction(fraction) };
}

export function setFolderExpanded(state: UiState, folder: string, expanded: boolean): UiState {
  const has = state.expandedFolders.includes(folder);
  if (has === expanded) return state;
  return {
    ...state,
    expandedFolders: expanded
      ? [...state.expandedFolders, folder]
      : state.expandedFolders.filter((p) => p !== folder),
  };
}

/** Rewrites every entry for a renamed file or folder, including everything inside a folder. */
export function renameInUiState(state: UiState, from: string, to: string): UiState {
  const rename = (p: string) => renamedPath(p, from, to) ?? p;
  const files: Record<string, FileUiState> = {};
  for (const [path, value] of Object.entries(state.files)) files[rename(path)] = value;
  return {
    ...state,
    expandedFolders: [...new Set(state.expandedFolders.map(rename))],
    recentFiles: [...new Set(state.recentFiles.map(rename))],
    currentFile: state.currentFile === undefined ? undefined : rename(state.currentFile),
    files,
  };
}

/** Removes every entry for a deleted file or folder, including everything inside a folder. */
export function deleteInUiState(state: UiState, path: string): UiState {
  return pruneUiState(state, (p) => !isSameOrInside(p, path));
}

export type EntryKind = "file" | "folder";

/**
 * Drops entries for files and folders that no longer exist (for example deleted by a coding
 * agent). `kindOf` reports what is at a path, or `undefined` if nothing is.
 */
export function pruneMissing(state: UiState, kindOf: (path: string) => EntryKind | undefined): UiState {
  const isFile = (p: string) => kindOf(p) === "file";
  const files: Record<string, FileUiState> = {};
  for (const [path, value] of Object.entries(state.files)) if (isFile(path)) files[path] = value;
  return {
    ...state,
    expandedFolders: state.expandedFolders.filter((p) => kindOf(p) === "folder"),
    recentFiles: state.recentFiles.filter(isFile),
    currentFile: state.currentFile !== undefined && isFile(state.currentFile) ? state.currentFile : undefined,
    files,
  };
}

function pruneUiState(state: UiState, keep: (path: string) => boolean): UiState {
  const files: Record<string, FileUiState> = {};
  for (const [path, value] of Object.entries(state.files)) if (keep(path)) files[path] = value;
  return {
    ...state,
    expandedFolders: state.expandedFolders.filter(keep),
    recentFiles: state.recentFiles.filter(keep),
    currentFile: state.currentFile !== undefined && keep(state.currentFile) ? state.currentFile : undefined,
    files,
  };
}
