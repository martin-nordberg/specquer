import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SectionInfo, SectionStatusLists } from "@specquer/shared/api";
import { type OutlineItem, type SummarizedSection, itemPathAt, outlineKeys, visibleAt } from "@specquer/shared/markdown";
import type { SectionStatus } from "@specquer/shared/sections";
import { badgeStatus, statusLabel } from "@/app/section-status";
import { sharedPreviewRenderer } from "@/preview/renderer";
import type { TopPositionStore } from "@/app/top-position";
import { type ItemMarks, OutlineTree } from "./OutlineTree";

/** The tree follows typing this long after it stops (Step 016, R2.5). */
export const OUTLINE_DEBOUNCE = 250;
/** Reports this soon after a click come from the click's own scrolling (R6.5). */
const CLICK_SETTLE = 300;

export interface OutlineDocument {
  path: string;
  body: string;
  /** Whether the document is in a sectioned folder: sections, or else headings (R2.1, R2.2). */
  sectioned: boolean;
  /** The file's version on disk, to load its sections' problems again after a save. */
  savedVersion: string;
}

export interface OutlinePaneProps {
  /** The open Markdown document, or `null`. */
  document: OutlineDocument | null;
  /** A file other than Markdown is open (R9.1). */
  notMarkdown: boolean;
  statusLists?: SectionStatusLists;
  /** The document's sections, for the badges' problems. */
  loadSections?: (path: string) => Promise<SectionInfo[]>;
  /** The sections the preview shows summarized; none in the Text and WYSIWYG views (R7.4). */
  summarized: readonly SummarizedSection[];
  /** The file's collapsed items, by key (R4.4). */
  collapsed: readonly string[];
  onCollapse: (key: string, collapsed: boolean) => void;
  /** Drops collapsed keys no longer in the document, once each time it is opened (R11.2). */
  onPrune: (keys: ReadonlySet<string>) => void;
  topPositions: TopPositionStore;
  /** Scrolls the file pane to an item's section (R5.1). */
  onMove: (item: OutlineItem) => void;
  /** **Add section anchors…** for the open file (R10). */
  onAddAnchors: () => void;
}

/** A value that follows another, `delay` milliseconds after it stops changing. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * The key to highlight for a path of keys down to an item: the deepest one shown. A path that
 * goes on into a summarized or collapsed item stops there, and highlights it fainter (R4.5, R7.6).
 */
function shownHighlight(items: readonly OutlineItem[], path: readonly string[], collapsed: ReadonlySet<string>): { key: string; inside: boolean } | null {
  let list = items;
  let found: string | null = null;
  for (const [index, key] of path.entries()) {
    const item = list.find((candidate) => candidate.key === key);
    if (item === undefined) return found === null ? null : { key: found, inside: true };
    found = key;
    if (index < path.length - 1 && (collapsed.has(key) || item.children.length === 0)) return { key, inside: true };
    list = item.children;
  }
  return found === null ? null : { key: found, inside: false };
}

/** The keys from the top level down to an item, by key. */
function pathTo(items: readonly OutlineItem[], key: string): string[] {
  for (const item of items) {
    if (item.key === key) return [key];
    const below = pathTo(item.children, key);
    if (below.length > 0) return [item.key, ...below];
  }
  return [];
}

/**
 * The Outline pane (Step 016): the open document's sections, or headings, as a tree that moves
 * the file pane and follows it, showing only what the summary slider leaves.
 */
export function OutlinePane(props: OutlinePaneProps) {
  const { document, statusLists, loadSections, summarized, onPrune, topPositions } = props;
  const path = document?.path ?? null;
  // Debounced as one string, so renders that change neither don't restart the wait
  const debounced = useDebounced(`${path ?? ""}\u0000${document?.body ?? ""}`, OUTLINE_DEBOUNCE);
  const split = debounced.indexOf("\u0000");
  const sectioned = document?.sectioned ?? false;
  // The body the tree is for: the debounced one while typing, the new one at once for another document
  const shownBody = document === null ? "" : debounced.slice(0, split) === path ? debounced.slice(split + 1) : document.body;

  // The tree and the statuses come from the preview worker: parsing a large document takes a few
  // hundred milliseconds, too long for the main thread while the user types (R8)
  const [outline, setOutline] = useState<{ path: string | null; body: string; items: OutlineItem[]; statuses: ReadonlyMap<string, SectionStatus> }>({
    path: null,
    body: "",
    items: [],
    statuses: new Map(),
  });
  const folderPrefix = statusLists?.folderPrefix ?? null;
  const statusValues = statusLists?.statusValues;
  useEffect(() => {
    if (path === null) return;
    let current = true;
    sharedPreviewRenderer()
      .outline(shownBody, { sectioned, ...(statusValues === undefined ? {} : { lists: { folderPrefix, statusValues } }) })
      .then((result) => {
        if (current) setOutline({ path, body: shownBody, items: result.items, statuses: new Map(result.statuses) });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [path, shownBody, sectioned, folderPrefix, statusValues]);
  // Another document's tree isn't shown while this one's is worked out
  const tree = outline.path === path ? outline.items : [];
  const visible = useMemo(() => visibleAt(tree, summarized), [tree, summarized]);
  const collapsed = useMemo(() => new Set(props.collapsed), [props.collapsed]);

  // Collapsed keys no longer in the document are dropped once, when it is opened
  const pruned = useRef<string | null>(null);
  useEffect(() => {
    if (path === null || pruned.current === path || outline.path !== path || outline.body !== (document?.body ?? "")) return;
    pruned.current = path;
    onPrune(new Set(outlineKeys(outline.items)));
  }, [path, outline, document?.body, onPrune]);

  // The badges' marks: an ID used twice, or a status that isn't allowed
  const [problems, setProblems] = useState<ReadonlyMap<string, true>>(new Map());
  const savedVersion = document?.savedVersion;
  useEffect(() => {
    setProblems(new Map());
    if (path === null || loadSections === undefined || !sectioned) return;
    let current = true;
    loadSections(path)
      .then((sections) => current && setProblems(new Map(sections.filter((section) => section.problem !== undefined && section.uid !== null).map((section) => [section.uid!, true as const]))))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [path, loadSections, sectioned, savedVersion]);
  const statuses = outline.statuses;
  const marks = useCallback<ItemMarks>(
    (item) => {
      if (item.uid === null) return { problem: false };
      const found = statuses.get(item.uid);
      const status = found === undefined ? undefined : badgeStatus(found);
      return { problem: problems.has(item.uid) || status?.invalid === true, ...(status === undefined ? {} : { label: statusLabel(status) }) };
    },
    [statuses, problems],
  );

  // The highlight: the item clicked, until the file pane is scrolled again; else the section at its top
  const [clicked, setClicked] = useState<{ key: string; at: number } | null>(null);
  const top = useSyncExternalStore(topPositions.subscribe, topPositions.get);
  useEffect(() => setClicked(null), [path]);
  const following = clicked === null || (top !== null && top.at > clicked.at + CLICK_SETTLE);
  const highlightPath = useMemo(() => {
    if (!following) return pathTo(tree, clicked!.key);
    if (top === null) return [];
    const found = itemPathAt(tree, top.position);
    // Above the first heading (the root section, or text before it): the first item is the topmost one shown
    return found.length > 0 || tree[0] === undefined ? found : [tree[0].key];
  }, [following, top, tree, clicked]);
  const highlight = useMemo(() => shownHighlight(visible.items, highlightPath, collapsed), [visible.items, highlightPath, collapsed]);

  // The highlighted row is scrolled into view, unless the reader is in the pane (R6.3)
  const pane = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const onHighlightRow = useCallback((row: HTMLElement) => {
    const element = pane.current;
    if (element === null || hovered.current || element.contains(globalThis.document?.activeElement ?? null)) return;
    row.scrollIntoView?.({ block: "nearest" });
  }, []);

  const move = (item: OutlineItem) => {
    setClicked({ key: item.key, at: performance.now() });
    props.onMove(item);
  };

  const empty = (message: string) => <p className="p-4 text-sm text-muted-foreground">{message}</p>;
  let content;
  if (props.notMarkdown) content = <p className="p-4 text-sm">(Not Markdown)</p>;
  else if (document === null) content = empty("Open a document to see its outline.");
  else if (visible.whole) content = empty("The whole document is summarized. Move the summary slider to see its sections.");
  else if (visible.items.length === 0) content = empty("This document has no headings.");
  else
    content = (
      <OutlineTree
        items={visible.items}
        summarized={visible.summarized}
        collapsed={collapsed}
        highlight={highlight}
        marks={marks}
        onToggle={(item, collapse) => props.onCollapse(item.key, collapse)}
        onMove={move}
        onHighlightRow={onHighlightRow}
      />
    );

  return (
    <div className="flex h-full flex-col" data-testid="outline-pane">
      <div className="flex shrink-0 items-center border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Outline</h2>
      </div>
      <div
        ref={pane}
        className="min-h-0 flex-1 overflow-auto py-1"
        onPointerEnter={() => (hovered.current = true)}
        onPointerLeave={() => (hovered.current = false)}
      >
        {content}
        {document !== null && !props.notMarkdown && (
          <button
            type="button"
            className="mx-3 mt-2 mb-3 rounded-sm text-sm text-primary underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-secondary"
            onClick={props.onAddAnchors}
          >
            Add section anchors…
          </button>
        )}
      </div>
    </div>
  );
}
