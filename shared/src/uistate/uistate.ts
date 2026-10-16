import { z } from "zod";
import { type CommentFilter, commentFilterSchema } from "../comments/comments.ts";
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
export const MIN_CHAT_PANE_FRACTION = 0.15;
export const MAX_CHAT_PANE_FRACTION = 0.5;
export const DEFAULT_CHAT_PANE_FRACTION = 0.3;
/** The file pane never gets narrower than this fraction of the window (Step 010, R1.4). */
export const MIN_FILE_PANE_FRACTION = 0.3;
/** Six heading levels and the whole document. */
export const MAX_SUMMARY_STEPS = 7;

export const viewTypes = ["text", "split", "preview", "wysiwyg"] as const;
export const viewTypeSchema = z.enum(viewTypes);
export type ViewType = z.infer<typeof viewTypeSchema>;

export const themeSchema = z.enum(["light", "dark"]);

/** What the third pane shows: AI Chat, Comments, the Outline (Step 016), or nothing (`null`) (Step 012, R1.3). */
export const sidePaneSchema = z.enum(["chat", "comments", "outline"]);
export type SidePane = z.infer<typeof sidePaneSchema>;

/** What the folder pane shows: Markdown files (`specs`) or every file (`all`) (Step 014, R1). */
export const treeViewSchema = z.enum(["specs", "all"]);
export type TreeView = z.infer<typeof treeViewSchema>;
export type Theme = z.infer<typeof themeSchema>;

export const fileUiStateSchema = z.object({
  viewType: viewTypeSchema.catch("text"),
  /** Height of the front matter editor in pixels (the drag bar position). */
  frontmatterHeight: z.number().positive().optional().catch(undefined),
  /** The summary slider's position, as steps from the full text (0, or absent, is the full text). */
  summaryStop: z.number().int().min(0).max(MAX_SUMMARY_STEPS).optional().catch(undefined),
  /** The Outline's collapsed items, by key: section UIDs, or `path:` and an outline path (Step 016, R11.2). */
  outlineCollapsed: z
    .array(z.unknown())
    .transform((keys) => [...new Set(keys.filter((key): key is string => typeof key === "string"))])
    .optional()
    .catch(undefined),
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
  /** The pane open in the third pane's place, if any (Step 012; before it, `chatOpen`). */
  sidePane: sidePaneSchema.nullable().catch(null),
  /** Width of the chat pane as a fraction of the window. */
  chatPaneFraction: z
    .number()
    .min(MIN_CHAT_PANE_FRACTION)
    .max(MAX_CHAT_PANE_FRACTION)
    .catch(DEFAULT_CHAT_PANE_FRACTION),
  /** Width of the Comments pane, with the chat pane's limits. */
  commentsPaneFraction: z
    .number()
    .min(MIN_CHAT_PANE_FRACTION)
    .max(MAX_CHAT_PANE_FRACTION)
    .catch(DEFAULT_CHAT_PANE_FRACTION),
  /** Width of the Outline pane, with the chat pane's limits (Step 016). */
  outlinePaneFraction: z
    .number()
    .min(MIN_CHAT_PANE_FRACTION)
    .max(MAX_CHAT_PANE_FRACTION)
    .catch(DEFAULT_CHAT_PANE_FRACTION),
  /** Which comment threads the pane, the pips and F8 show. */
  commentFilter: commentFilterSchema.catch("open"),
  /** The folder pane's view; both views share the expanded folders. */
  treeView: treeViewSchema.catch("specs"),
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
    sidePane: sidePaneSchema.nullable(),
    chatPaneFraction: z.number().min(MIN_CHAT_PANE_FRACTION).max(MAX_CHAT_PANE_FRACTION),
    commentsPaneFraction: z.number().min(MIN_CHAT_PANE_FRACTION).max(MAX_CHAT_PANE_FRACTION),
    outlinePaneFraction: z.number().min(MIN_CHAT_PANE_FRACTION).max(MAX_CHAT_PANE_FRACTION),
    commentFilter: commentFilterSchema,
    treeView: treeViewSchema,
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
    sidePane: null,
    chatPaneFraction: DEFAULT_CHAT_PANE_FRACTION,
    commentsPaneFraction: DEFAULT_CHAT_PANE_FRACTION,
    outlinePaneFraction: DEFAULT_CHAT_PANE_FRACTION,
    commentFilter: "open",
    treeView: "specs",
    expandedFolders: [],
    recentFiles: [],
    files: {},
  };
}

/** Parses stored content, replacing anything invalid with defaults. */
export function parseUiState(value: unknown): UiState {
  // Before Step 012, an open chat pane was `chatOpen: true`
  if (typeof value === "object" && value !== null && !("sidePane" in value) && (value as { chatOpen?: unknown }).chatOpen === true) {
    value = { ...value, sidePane: "chat" };
  }
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
  if (from.sidePane !== to.sidePane) patch.sidePane = to.sidePane;
  if (from.chatPaneFraction !== to.chatPaneFraction) patch.chatPaneFraction = to.chatPaneFraction;
  if (from.commentsPaneFraction !== to.commentsPaneFraction) patch.commentsPaneFraction = to.commentsPaneFraction;
  if (from.outlinePaneFraction !== to.outlinePaneFraction) patch.outlinePaneFraction = to.outlinePaneFraction;
  if (from.commentFilter !== to.commentFilter) patch.commentFilter = to.commentFilter;
  if (from.treeView !== to.treeView) patch.treeView = to.treeView;
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

/** Sets the summary slider's position, as steps from the full text; 0 drops the field. */
export function setSummaryStop(state: UiState, path: string, steps: number): UiState {
  const { summaryStop: _, ...rest } = fileUiState(state, path);
  const clamped = Math.min(MAX_SUMMARY_STEPS, Math.max(0, Math.round(steps)));
  return { ...state, files: { ...state.files, [path]: clamped === 0 ? rest : { ...rest, summaryStop: clamped } } };
}

/**
 * The stored position as a slider stop (0 is the whole document, `stopCount - 1` the full
 * text), clamped to the stops a document has (decision D3).
 */
export function summaryStopOf(file: FileUiState, stopCount: number): number {
  if (stopCount === 0) return 0;
  return Math.max(0, stopCount - 1 - (file.summaryStop ?? 0));
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

export function clampChatPaneFraction(fraction: number): number {
  return Math.min(MAX_CHAT_PANE_FRACTION, Math.max(MIN_CHAT_PANE_FRACTION, fraction));
}

/** Opens a pane in the third pane's place (closing the other), or closes it (`null`). */
export function setSidePane(state: UiState, pane: SidePane | null): UiState {
  return state.sidePane === pane ? state : { ...state, sidePane: pane };
}

/** The icons' three-way toggle: an icon opens its pane, or closes it when it is open. */
export function toggleSidePane(state: UiState, pane: SidePane): UiState {
  return setSidePane(state, state.sidePane === pane ? null : pane);
}

export function setChatPaneFraction(state: UiState, fraction: number): UiState {
  return { ...state, chatPaneFraction: clampChatPaneFraction(fraction) };
}

export function setCommentsPaneFraction(state: UiState, fraction: number): UiState {
  return { ...state, commentsPaneFraction: clampChatPaneFraction(fraction) };
}

export function setOutlinePaneFraction(state: UiState, fraction: number): UiState {
  return { ...state, outlinePaneFraction: clampChatPaneFraction(fraction) };
}

/** Collapses or expands an Outline item of a file (Step 016, R4.4); an empty list is dropped. */
export function setOutlineCollapsed(state: UiState, path: string, key: string, collapsed: boolean): UiState {
  const { outlineCollapsed = [], ...rest } = fileUiState(state, path);
  if (outlineCollapsed.includes(key) === collapsed) return state;
  const next = collapsed ? [...outlineCollapsed, key] : outlineCollapsed.filter((k) => k !== key);
  return { ...state, files: { ...state.files, [path]: next.length === 0 ? rest : { ...rest, outlineCollapsed: next } } };
}

/** Drops a file's collapsed Outline items that are no longer in the document (R11.2). */
export function pruneOutlineCollapsed(state: UiState, path: string, keys: ReadonlySet<string>): UiState {
  const { outlineCollapsed, ...rest } = fileUiState(state, path);
  if (outlineCollapsed === undefined) return state;
  const kept = outlineCollapsed.filter((key) => keys.has(key));
  if (kept.length === outlineCollapsed.length) return state;
  return { ...state, files: { ...state.files, [path]: kept.length === 0 ? rest : { ...rest, outlineCollapsed: kept } } };
}

export function setCommentFilter(state: UiState, filter: CommentFilter): UiState {
  return state.commentFilter === filter ? state : { ...state, commentFilter: filter };
}

export function setTreeView(state: UiState, treeView: TreeView): UiState {
  return state.treeView === treeView ? state : { ...state, treeView };
}

/**
 * The widths shown, as fractions of the window: the file pane keeps at least
 * `MIN_FILE_PANE_FRACTION`, the right pane (chat or comments) giving way first (down to its
 * minimum), then the folder pane (Step 010, R1.4). The stored fractions aren't changed, so
 * closing the right pane restores the folder pane's own width.
 */
export function paneWidths(tree: number, right: number, rightOpen: boolean): { tree: number; right: number; file: number } {
  let shownTree = clampTreePaneFraction(tree);
  let shownRight = rightOpen ? clampChatPaneFraction(right) : 0;
  const room = 1 - MIN_FILE_PANE_FRACTION;
  if (shownTree + shownRight > room && rightOpen) shownRight = Math.max(MIN_CHAT_PANE_FRACTION, room - shownTree);
  if (shownTree + shownRight > room) shownTree = Math.max(MIN_TREE_PANE_FRACTION, room - shownRight);
  return { tree: shownTree, right: shownRight, file: 1 - shownTree - shownRight };
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
