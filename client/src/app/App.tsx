import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Tree, TreeFolder, TreeNode } from "@specquer/shared/api";
import { isSameOrInside, renamedPath } from "@specquer/shared/paths";
import {
  type UiState,
  closeFile,
  fileUiState,
  openFile,
  setFolderExpanded,
  setFrontmatterHeight,
  setTheme,
  setTreePaneFraction,
  setViewType,
} from "@specquer/shared/uistate";
import { AnchorDialog } from "@/components/AnchorDialog";
import { ConflictDialog } from "@/components/ConflictDialog";
import { ContentView, ViewSwitcher } from "@/components/ContentView";
import { CreateDialog, type CreateRequest, DeleteDialog, RenameDialog } from "@/components/EntryDialogs";
import { FilePath } from "@/components/FilePath";
import { FileTree } from "@/components/FileTree";
import { FrontmatterEditor, initialFrontmatterHeight } from "@/components/FrontmatterEditor";
import type { ScrollTarget } from "@/components/Preview";
import { ProblemsDialog } from "@/components/ProblemsDialog";
import { SectionNotices } from "@/components/SectionNotices";
import { SplitPane } from "@/components/SplitPane";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Api } from "@/lib/api";
import { appIconSvg, svgDataUri } from "@/theme/logo";
import { applyTheme, useSystemTheme } from "@/theme/theme";
import { AUTOSAVE_INTERVAL, DocumentStore, type SaveStatus } from "./document-store";
import { UiStateStore } from "./ui-state-store";

const appIconUri = svgDataUri(appIconSvg);

const statusText: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  conflict: "Not saved: changed on disk",
  error: "Save failed",
};

/** Loads the UI state and tree, then shows the editor. */
export function App({ api }: { api: Api }) {
  const [initial, setInitial] = useState<{ uiState: UiState; tree: Tree } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getUiState(), api.getTree()])
      .then(([uiState, tree]) => setInitial({ uiState, tree }))
      .catch((err: Error) => setError(err.message));
  }, [api]);

  if (error !== null) return <p className="p-6 text-error-text">Couldn't load Specquer: {error}</p>;
  if (initial === null) return <p className="p-6 text-muted-foreground">Loading…</p>;
  return <Workspace api={api} initialUiState={initial.uiState} initialTree={initial.tree} />;
}

function Workspace({ api, initialUiState, initialTree }: { api: Api; initialUiState: UiState; initialTree: Tree }) {
  const uiStore = useMemo(() => new UiStateStore(api, initialUiState), [api, initialUiState]);
  const docStore = useMemo(() => new DocumentStore(api), [api]);
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.get);
  const doc = useSyncExternalStore(docStore.subscribe, docStore.get);
  const [tree, setTree] = useState(initialTree);
  const [creating, setCreating] = useState<CreateRequest | null>(null);
  const [renaming, setRenaming] = useState<TreeNode | null>(null);
  const [deleting, setDeleting] = useState<TreeNode | null>(null);
  const [anchoring, setAnchoring] = useState<TreeFolder | null>(null);
  const [checking, setChecking] = useState<TreeFolder | null>(null);
  const [scrollTarget, setScrollTarget] = useState<(ScrollTarget & { path: string }) | undefined>(undefined);
  const [openError, setOpenError] = useState<string | null>(null);

  const systemTheme = useSystemTheme();
  const theme = ui.theme ?? systemTheme;
  useEffect(() => applyTheme(theme), [theme]);

  const refreshTree = useCallback(async () => setTree(await api.getTree()), [api]);

  /**
   * Saves the current file, then opens another. Stays put if the save didn't succeed. With a
   * section ID, the preview then scrolls to that section.
   */
  const open = useCallback(
    async (path: string, sectionId?: string) => {
      if (sectionId !== undefined) setScrollTarget({ path, sectionId, request: Date.now() });
      if (docStore.get().document?.path === path) return;
      const saved = await docStore.save();
      if (saved === "conflict" || saved === "error") return;
      try {
        await docStore.open(path);
        setOpenError(null);
        uiStore.update((state) => openFile(state, path));
      } catch (err) {
        setOpenError(`Couldn't open ${path}: ${(err as Error).message}`);
      }
    },
    [docStore, uiStore],
  );

  // Reopen the file that was open last time
  useEffect(() => {
    const path = initialUiState.currentFile;
    if (path === undefined) return;
    docStore.open(path).catch(() => uiStore.update(closeFile));
  }, [docStore, uiStore, initialUiState]);

  // Autosave: when the tab loses focus or the page closes, and every minute while there are changes
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      void docStore.save({ keepalive: true });
      void uiStore.flush({ keepalive: true });
    };
    const onPageHide = () => {
      void docStore.save({ keepalive: true });
      void uiStore.flush({ keepalive: true });
    };
    const timer = setInterval(() => {
      if (docStore.hasUnsavedChanges) void docStore.save();
    }, AUTOSAVE_INTERVAL);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [docStore, uiStore]);

  /** Creates the entry, shows it in its expanded folder, and opens a new file. */
  const create = useCallback(
    async ({ parent, kind }: CreateRequest, name: string): Promise<string | null> => {
      try {
        const result = await api.create(parent.path, name, kind);
        if (result.kind === "exists") return result.message;
        if (parent.path !== "") uiStore.update((state) => setFolderExpanded(state, parent.path, true));
        await refreshTree();
        if (kind === "file") void open(result.path);
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [api, uiStore, refreshTree, open],
  );

  const rename = useCallback(
    async (node: TreeNode, newName: string): Promise<string | null> => {
      const current = docStore.get().document?.path;
      if (current !== undefined && isSameOrInside(current, node.path)) {
        const saved = await docStore.save();
        if (saved === "conflict" || saved === "error") return "Save or resolve the open file's changes first.";
      }
      await uiStore.flush();
      try {
        const result = await api.rename(node.path, newName);
        if (result.kind === "exists") return result.message;
        if (current !== undefined) {
          const moved = renamedPath(current, node.path, result.path);
          if (moved !== undefined) docStore.moved(moved);
        }
        uiStore.reset(result.uiState);
        await refreshTree();
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [api, docStore, uiStore, refreshTree],
  );

  const remove = useCallback(
    async (node: TreeNode): Promise<string | null> => {
      await uiStore.flush();
      try {
        const uiState = await api.deleteEntry(node.path);
        const current = docStore.get().document?.path;
        if (current !== undefined && isSameOrInside(current, node.path)) docStore.close();
        uiStore.reset(uiState);
        await refreshTree();
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [api, docStore, uiStore],
  );

  const document_ = doc.document;
  const fileState = document_ === null ? null : fileUiState(ui, document_.path);
  const expanded = useMemo(() => new Set(ui.expandedFolders), [ui.expandedFolders]);
  const openFromUi = useCallback((path: string, sectionId?: string) => void open(path, sectionId), [open]);
  const searchSections = useCallback((query: string, path?: string) => api.searchSections(query, { path }), [api]);

  /** The dry run of **Add section anchors**, after saving the open file. */
  const anchorChanges = useCallback(
    async (folder: string) => {
      const saved = await docStore.save();
      if (saved === "conflict" || saved === "error") throw new Error("Save or resolve the open file's changes first.");
      return api.anchorFolder(folder, true);
    },
    [api, docStore],
  );

  const addAnchors = useCallback(
    async (folder: string, addAgentGuide: boolean): Promise<string | null> => {
      try {
        const saved = await docStore.save();
        if (saved === "conflict" || saved === "error") return "Save or resolve the open file's changes first.";
        const { files } = await api.anchorFolder(folder, false, addAgentGuide);
        const current = docStore.get().document?.path;
        // The open file was saved first, so reloading it loses nothing
        if (current !== undefined && files.includes(current) && !docStore.hasUnsavedChanges) await docStore.reloadTheirs();
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [api, docStore],
  );

  /** **Section problems**, after saving the open file so it is checked as shown. */
  const loadProblems = useCallback(
    async (folder: string) => {
      await docStore.save();
      return api.sectionProblems(folder);
    },
    [api, docStore],
  );

  const renumberOpen = useCallback((id: string, uid: string | null) => void docStore.renumber(id, uid), [docStore]);

  /** Renumbers one occurrence of a duplicate ID: through the open file's store if it is open. */
  const renumberIn = useCallback(
    async (path: string, id: string, uid: string | null): Promise<string | null> => {
      try {
        if (docStore.get().document?.path === path) {
          const result = await docStore.renumber(id, uid);
          return result === "conflict" || result === "error" ? "Save or resolve the open file's changes first." : null;
        }
        const file = await api.readFile(path);
        const outcome = await api.renumberSection(path, id, uid, file.version);
        return outcome.kind === "conflict" ? `${path} changed on disk; try again.` : null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [api, docStore],
  );

  const left = (
    <nav aria-label="Folders" className="flex h-full flex-col overflow-auto">
      <FileTree
        root={tree.root}
        expanded={expanded}
        currentFile={document_?.path}
        onToggleFolder={(path, isExpanded) => uiStore.update((s) => setFolderExpanded(s, path, isExpanded))}
        onOpenFile={openFromUi}
        onNewFile={(folder) => setCreating({ parent: folder, kind: "file" })}
        onNewFolder={(folder) => setCreating({ parent: folder, kind: "folder" })}
        onAddAnchors={setAnchoring}
        onShowProblems={setChecking}
        onRename={setRenaming}
        onDelete={setDeleting}
      />
      {tree.truncated && <p className="shrink-0 p-2 text-xs text-muted-foreground">Too many files: the list is incomplete.</p>}
    </nav>
  );

  const right =
    document_ === null || fileState === null ? (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {openError ?? "Select a file in the folder pane."}
      </div>
    ) : (
      <>
        <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
          <FilePath path={document_.path} recentFiles={ui.recentFiles} onOpenFile={openFromUi} />
          <span
            role="status"
            aria-label="Save status"
            className={doc.status === "conflict" || doc.status === "error" ? "text-xs text-error-text" : "text-xs text-muted-foreground"}
            title={doc.error ?? undefined}
          >
            {statusText[doc.status]}
          </span>
          <ViewSwitcher value={fileState.viewType} onChange={(view) => uiStore.update((s) => setViewType(s, document_.path, view))} />
        </div>
        {openError !== null && <p className="border-b px-3 py-1 text-sm text-error-text">{openError}</p>}
        <SectionNotices notices={doc.notices} onDismiss={() => docStore.dismissNotices()} onShowProblems={() => setChecking(tree.root)} />
        <FrontmatterEditor
          key={`fm:${document_.revision}`}
          value={document_.frontmatter ?? ""}
          onChange={(text) => docStore.setFrontmatter(text)}
          height={fileState.frontmatterHeight ?? initialFrontmatterHeight(document_.openedWithFrontmatter)}
          onHeightChange={(height) => uiStore.update((s) => setFrontmatterHeight(s, document_.path, height))}
        />
        <div className="min-h-0 flex-1">
          <ContentView
            key={`${fileState.viewType}:${document_.revision}`}
            viewType={fileState.viewType}
            body={document_.body}
            path={document_.path}
            externalEdits={document_.externalEdits}
            onChange={(body) => docStore.setBody(body)}
            onOpenFile={openFromUi}
            loadSections={api.getSections}
            searchSections={searchSections}
            savedVersion={doc.version}
            onRenumber={renumberOpen}
            scrollTarget={scrollTarget?.path === document_.path ? scrollTarget : undefined}
          />
        </div>
        <ConflictDialog
          path={document_.path}
          open={doc.conflict !== null}
          onReloadTheirs={() => void docStore.reloadTheirs()}
          onKeepMine={() => void docStore.keepMine()}
        />
      </>
    );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between bg-navigation px-4 text-navigation-foreground">
        <span className="flex items-center gap-2 font-semibold tracking-wide">
          <img src={appIconUri} alt="" className="size-6" />
          Specquer
        </span>
        <ThemeToggle theme={theme} onChange={(next) => uiStore.update((s) => setTheme(s, next))} />
      </header>
      <main className="min-h-0 flex-1">
        <SplitPane
          fraction={ui.treePaneFraction}
          onFractionChange={(fraction) => uiStore.update((s) => setTreePaneFraction(s, fraction))}
          left={left}
          right={right}
        />
      </main>
      <CreateDialog request={creating} onClose={() => setCreating(null)} onCreate={create} />
      <RenameDialog node={renaming} onClose={() => setRenaming(null)} onRename={rename} />
      <DeleteDialog node={deleting} onClose={() => setDeleting(null)} loadPreview={api.deletePreview} onDelete={remove} />
      <AnchorDialog folder={anchoring} onClose={() => setAnchoring(null)} loadChanges={anchorChanges} onRun={addAnchors} />
      <ProblemsDialog folder={checking} onClose={() => setChecking(null)} loadProblems={loadProblems} onOpen={openFromUi} onRenumber={renumberIn} />
    </div>
  );
}
