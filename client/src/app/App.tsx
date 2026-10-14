import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CreateOptions, SectionStatusLists, SummaryStatus, Tree, TreeFolder, TreeNode } from "@specquer/shared/api";
import type { Citation } from "@specquer/shared/chat";
import { analyzeBody } from "@specquer/shared/markdown";
import { isSameOrInside, renamedPath } from "@specquer/shared/paths";
import {
  type UiState,
  closeFile,
  fileUiState,
  openFile,
  setCommentFilter,
  setCommentsPaneFraction,
  toggleSidePane,
  setChatPaneFraction,
  setFolderExpanded,
  setFrontmatterHeight,
  setSummaryStop,
  setTheme,
  setTreePaneFraction,
  setViewType,
} from "@specquer/shared/uistate";
import { AnchorDialog } from "@/components/AnchorDialog";
import { ChatPane } from "@/components/chat/ChatPane";
import { ChatToggle } from "@/components/chat/ChatToggle";
import { CommentsPane } from "@/components/comments/CommentsPane";
import { CommentsToggle } from "@/components/comments/CommentsToggle";
import { ConflictDialog } from "@/components/ConflictDialog";
import { ContentView, ViewSwitcher } from "@/components/ContentView";
import { CreateDialog, type CreateRequest, DeleteDialog, RenameDialog } from "@/components/EntryDialogs";
import { FilePath } from "@/components/FilePath";
import { FileTree } from "@/components/FileTree";
import { FrontmatterEditor, initialFrontmatterHeight } from "@/components/FrontmatterEditor";
import type { PreviewSummaries, ScrollTarget } from "@/components/Preview";
import { ProblemsDialog } from "@/components/ProblemsDialog";
import { FolderSettingsDialog } from "@/components/settings/FolderSettingsDialog";
import { SettingsButton } from "@/components/settings/SettingsButton";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { SectionNotices } from "@/components/SectionNotices";
import { PaneLayout } from "@/components/PaneLayout";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Api } from "@/lib/api";
import { appIconSvg, svgDataUri } from "@/theme/logo";
import { applyTheme, useSystemTheme } from "@/theme/theme";
import { ChatStore } from "./chat-store";
import { CommentStore } from "./comment-store";
import { AUTOSAVE_INTERVAL, DocumentStore, type SaveStatus } from "./document-store";
import { SummaryStore } from "./summaries";
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
  const summaryStore = useMemo(() => new SummaryStore(api), [api]);
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.get);
  const doc = useSyncExternalStore(docStore.subscribe, docStore.get);
  const [tree, setTree] = useState(initialTree);
  const [creating, setCreating] = useState<CreateRequest | null>(null);
  const [renaming, setRenaming] = useState<TreeNode | null>(null);
  const [deleting, setDeleting] = useState<TreeNode | null>(null);
  const [anchoring, setAnchoring] = useState<TreeFolder | null>(null);
  const [checking, setChecking] = useState<TreeFolder | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [folderSettings, setFolderSettings] = useState<TreeFolder | null>(null);
  const [scrollTarget, setScrollTarget] = useState<(ScrollTarget & { path: string }) | undefined>(undefined);
  // The configured model, for an answer stopped before the server named it
  const modelRef = useRef<string | undefined>(undefined);
  const chatStore = useMemo(
    () =>
      new ChatStore({
        api,
        saveOpenFile: () => docStore.save(),
        // Resolves once the conflict dialog has been answered
        conflictSettled: () =>
          new Promise<void>((resolve) => {
            if (docStore.get().conflict === null) return resolve();
            const unsubscribe = docStore.subscribe(() => {
              if (docStore.get().conflict !== null) return;
              unsubscribe();
              resolve();
            });
          }),
        openFile: () => docStore.get().document?.path,
        model: () => modelRef.current,
      }),
    [api, docStore],
  );
  const chat = useSyncExternalStore(chatStore.subscribe, chatStore.get);
  useEffect(() => () => chatStore.close(), [chatStore]);
  const commentStore = useMemo(() => new CommentStore(api), [api]);
  const comments = useSyncExternalStore(commentStore.subscribe, commentStore.get);
  const [openError, setOpenError] = useState<string | null>(null);

  const systemTheme = useSystemTheme();
  const theme = ui.theme ?? systemTheme;
  useEffect(() => applyTheme(theme), [theme]);

  const refreshTree = useCallback(async () => setTree(await api.getTree()), [api]);

  // Whether summaries can be made: asked once per page load and whenever the tab gets focus, so
  // editing the agent configuration takes effect without a restart (decision D10)
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus | null>(null);
  const loadSummaryStatus = useCallback(
    () =>
      void api
        .summaryStatus()
        .then(setSummaryStatus)
        .catch(() => setSummaryStatus({ enabled: false, problem: "Couldn't ask the server whether summaries are enabled." })),
    [api],
  );
  useEffect(() => {
    modelRef.current = summaryStatus?.enabled === true ? summaryStatus.model : undefined;
  }, [summaryStatus]);
  // The conversation: loaded when the pane opens, and again when the tab gets focus
  useEffect(() => {
    if (ui.sidePane !== "chat") return;
    void chatStore.load();
    const onFocus = () => void chatStore.load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ui.sidePane, chatStore]);
  useEffect(() => {
    loadSummaryStatus();
    window.addEventListener("focus", loadSummaryStatus);
    return () => window.removeEventListener("focus", loadSummaryStatus);
  }, [loadSummaryStatus]);

  /**
   * Saves the current file, then opens another. Stays put if the save didn't succeed. With a
   * section ID (or a heading's outline path), the preview then scrolls to that section.
   */
  const open = useCallback(
    async (path: string, place?: string | { outlinePath: string }) => {
      if (typeof place === "string") setScrollTarget({ path, sectionId: place, request: Date.now() });
      else if (place !== undefined) setScrollTarget({ path, outlinePath: place.outlinePath, request: Date.now() });
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

  // Autosave: when the window loses focus (switching applications often leaves the tab visible),
  // when the tab is hidden or the page closes, and every minute while there are changes
  useEffect(() => {
    const onBlur = () => {
      void docStore.save();
      void uiStore.flush();
      void commentStore.flush();
    };
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      void docStore.save({ keepalive: true });
      void uiStore.flush({ keepalive: true });
      void commentStore.flush({ keepalive: true });
    };
    const onPageHide = () => {
      void docStore.save({ keepalive: true });
      void uiStore.flush({ keepalive: true });
      void commentStore.flush({ keepalive: true });
    };
    const timer = setInterval(() => {
      if (docStore.hasUnsavedChanges) void docStore.save();
    }, AUTOSAVE_INTERVAL);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [docStore, uiStore, commentStore]);

  /** Creates the entry, shows it in its expanded folder, and opens a new file. */
  const create = useCallback(
    async ({ parent, kind }: CreateRequest, name: string, options?: CreateOptions): Promise<string | null> => {
      try {
        const result = await api.create(parent.path, name, kind, options);
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

  // Citations (Step 010, R5): a citation without a section ID is gone when its file is
  const treeFiles = useMemo(() => {
    const files = new Set<string>();
    const walk = (folder: TreeFolder) => {
      for (const child of folder.children) {
        if (child.kind === "file") files.add(child.path);
        else walk(child);
      }
    };
    walk(tree.root);
    return files;
  }, [tree]);
  const isCitationMissing = useCallback((citation: Citation) => citation.sectionId === undefined && !treeFiles.has(citation.path), [treeFiles]);

  /**
   * Opens a citation in the preview: a section ID is looked up first, so the citation follows a
   * section moved since the answer; Text and WYSIWYG switch to Preview, which is remembered.
   */
  const openCitation = useCallback(
    async (citation: Citation) => {
      let path = citation.path;
      if (citation.sectionId !== undefined) {
        try {
          const found = (await api.searchSections(citation.sectionId, { limit: 5 })).find((result) => result.id === citation.sectionId);
          if (found !== undefined) path = found.path;
        } catch {
          // The stored path, then
        }
      }
      const view = fileUiState(uiStore.get(), path).viewType;
      if (view === "text" || view === "wysiwyg") uiStore.update((state) => setViewType(state, path, "preview"));
      await open(path, citation.sectionId ?? { outlinePath: citation.outlinePath });
    },
    [api, uiStore, open],
  );
  const chatDisabled =
    summaryStatus?.enabled === false ? { hint: "The chat needs a model: see .specquer/shared/agent.config.yaml", reason: summaryStatus.problem } : null;
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

  // Summaries are made from the saved file, which changes when it is read or written
  const savedBody = useMemo(() => docStore.savedBody(), [docStore, doc.version, document_?.path, document_?.revision]);
  const currentPath = document_?.path;
  const onSummaryStepsChange = useCallback(
    (steps: number) => {
      if (currentPath !== undefined) uiStore.update((s) => setSummaryStop(s, currentPath, steps));
    },
    [uiStore, currentPath],
  );
  const hasFile = fileState !== null;
  const storedSteps = fileState?.summaryStop ?? 0;
  const summaries = useMemo<PreviewSummaries | undefined>(
    () =>
      !hasFile
        ? undefined
        : {
            enabled: summaryStatus?.enabled === true,
            ...(summaryStatus?.problem === undefined ? {} : { problem: summaryStatus.problem }),
            savedBody,
            steps: storedSteps,
            onStepsChange: onSummaryStepsChange,
            store: summaryStore,
          },
    [hasFile, storedSteps, summaryStatus, savedBody, onSummaryStepsChange, summaryStore],
  );

  const renumberOpen = useCallback((id: string, uid: string | null) => void docStore.renumber(id, uid), [docStore]);

  // The open file's status lists: loaded when it opens, after each save, when the window regains
  // focus (prefix.config.yaml is edited by hand, usually elsewhere) and when a badge's menu opens
  const [statusLists, setStatusLists] = useState<{ path: string; lists: SectionStatusLists } | null>(null);
  const loadStatusLists = useCallback(() => {
    const path = docStore.get().document?.path;
    if (path === undefined) return;
    api
      .sectionStatuses(path)
      .then((lists) => {
        if (docStore.get().document?.path !== path) return;
        // The same lists keep their identity, so the badges (and an open menu) aren't rebuilt
        setStatusLists((current) => (current?.path === path && JSON.stringify(current.lists) === JSON.stringify(lists) ? current : { path, lists }));
      })
      .catch(() => undefined);
  }, [api, docStore]);
  useEffect(() => {
    if (currentPath !== undefined) loadStatusLists();
  }, [currentPath, doc.version, loadStatusLists]);
  // The open file's comment threads: when it opens, after each save (sections may have just got
  // their UIDs) and when the window regains focus (a Git pull, say)
  useEffect(() => {
    void commentStore.open(currentPath ?? null);
  }, [currentPath, doc.version, commentStore]);
  useEffect(() => {
    const onFocus = () => void commentStore.load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [commentStore]);
  /** Scrolls the document to a section by its UID. */
  const goToSection = useCallback(
    (sectionUid: string) => {
      const document = docStore.get().document;
      if (document === null) return;
      const section = analyzeBody(document.body).sections.find((found) => found.uid === sectionUid);
      if (section?.id != null) setScrollTarget({ path: document.path, sectionId: section.id, request: Date.now() });
    },
    [docStore],
  );
  useEffect(() => {
    window.addEventListener("focus", loadStatusLists);
    return () => window.removeEventListener("focus", loadStatusLists);
  }, [loadStatusLists]);
  const setStatus = useCallback((id: string, uid: string | null, status: string | null) => docStore.setStatus(id, uid, status), [docStore]);

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

  /** Renumbers a whole file as a copy: the open file is saved first, and reloaded after. */
  const renumberDocumentIn = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        const isOpen = docStore.get().document?.path === path;
        if (isOpen) {
          const saved = await docStore.save();
          if (saved === "conflict" || saved === "error") return "Save or resolve the open file's changes first.";
        }
        const file = await api.readFile(path);
        const outcome = await api.renumberDocument(path, file.version);
        if (outcome.kind === "conflict") return `${path} changed on disk; try again.`;
        if (isOpen && !docStore.hasUnsavedChanges) await docStore.reloadTheirs();
        return null;
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
        onFolderSettings={setFolderSettings}
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
            {doc.status === "unsaved" ? (
              // Saving brings the summaries up to date
              <button
                type="button"
                aria-label="Unsaved changes: save now"
                title="Save now"
                className="rounded-sm underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => void docStore.save()}
              >
                {statusText.unsaved}
              </button>
            ) : (
              statusText[doc.status]
            )}
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
            undoableEdits={document_.undoableEdits}
            statusLists={statusLists?.path === document_.path ? statusLists.lists : undefined}
            onSetStatus={setStatus}
            onStatusMenu={loadStatusLists}
            scrollTarget={scrollTarget?.path === document_.path ? scrollTarget : undefined}
            summaries={summaries}
            registerFlush={docStore.addFlusher}
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
        <span className="flex items-center gap-1">
          <CommentsToggle open={ui.sidePane === "comments"} onChange={() => uiStore.update((s) => toggleSidePane(s, "comments"))} />
          {/* Twice the space before the theme toggle (R1.1) */}
          <ChatToggle open={ui.sidePane === "chat"} onChange={() => uiStore.update((s) => toggleSidePane(s, "chat"))} className="mr-1" />
          <ThemeToggle theme={theme} onChange={(next) => uiStore.update((s) => setTheme(s, next))} />
          <SettingsButton onClick={() => setSettingsOpen(true)} />
        </span>
      </header>
      <main className="min-h-0 flex-1">
        <PaneLayout
          treeFraction={ui.treePaneFraction}
          rightFraction={ui.sidePane === "comments" ? ui.commentsPaneFraction : ui.chatPaneFraction}
          rightOpen={ui.sidePane !== null}
          rightLabel={ui.sidePane === "comments" ? "comments" : "chat"}
          onTreeFractionChange={(fraction) => uiStore.update((s) => setTreePaneFraction(s, fraction))}
          onRightFractionChange={(fraction) =>
            uiStore.update((s) => (s.sidePane === "comments" ? setCommentsPaneFraction(s, fraction) : setChatPaneFraction(s, fraction)))
          }
          left={left}
          center={right}
          right={
            ui.sidePane === "comments" ? (
              <CommentsPane
                state={comments}
                store={commentStore}
                body={document_?.body ?? null}
                lists={statusLists !== null && statusLists.path === document_?.path ? statusLists.lists : undefined}
                filter={ui.commentFilter}
                onFilterChange={(filter) => uiStore.update((s) => setCommentFilter(s, filter))}
                onGoToSection={goToSection}
              />
            ) : (
              <ChatPane
                state={chat}
                disabled={chatDisabled}
                onSend={(question) => void chatStore.send(question)}
                onStop={() => chatStore.stop()}
                onRetry={() => void chatStore.retry()}
                onClear={() => void chatStore.clear()}
                onUndo={() => void chatStore.undoClear()}
                onOpenCitation={(citation) => void openCitation(citation)}
                isMissing={isCitationMissing}
                onTakeDraft={() => chatStore.takeDraft()}
                onInput={() => chatStore.dismissUnknownCommand()}
              />
            )
          }
        />
      </main>
      <CreateDialog request={creating} onClose={() => setCreating(null)} onCreate={create} loadSettings={api.folderSettings} />
      <RenameDialog node={renaming} onClose={() => setRenaming(null)} onRename={rename} />
      <DeleteDialog node={deleting} onClose={() => setDeleting(null)} loadPreview={api.deletePreview} onDelete={remove} />
      <AnchorDialog folder={anchoring} onClose={() => setAnchoring(null)} loadChanges={anchorChanges} onRun={addAnchors} />
      <FolderSettingsDialog folder={folderSettings} onClose={() => setFolderSettings(null)} api={api} onAddAnchors={setAnchoring} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} api={api} onSaved={loadSummaryStatus} />
      <ProblemsDialog folder={checking} onClose={() => setChecking(null)} loadProblems={loadProblems} onOpen={openFromUi} onRenumber={renumberIn} onRenumberDocument={renumberDocumentIn} />
    </div>
  );
}
