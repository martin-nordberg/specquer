import type { Root, RootContent } from "hast";
import { type Components, toJsxRuntime } from "hast-util-to-jsx-runtime";
import { type ComponentProps, type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import type { SectionInfo, SectionStatusLists, SummaryRequest } from "@specquer/shared/api";
import {
  CLOBBER_PREFIX,
  OUTLINE_PATH_PROPERTY,
  SUMMARY_TAG,
  type SummarizedSection,
  type TopPosition,
  buildOutline,
  hasConflictMarkers,
  summarizeTree,
  summarizedAt,
  summaryStopCount,
  summaryStopName,
} from "@specquer/shared/markdown";
import { isMarkdownFile, normalizePath, parentPath } from "@specquer/shared/paths";
import { isShortSection, simplifySectionText } from "@specquer/shared/summaries";
import { allowedStatuses, badgeStatus, findSection, statusesOfBody } from "@/app/section-status";
import { type SummaryEntry, type SummaryStore, summaryKey } from "@/app/summaries";
import { SectionAttributesDialog, type SectionAttributesTarget } from "@/components/SectionAttributesDialog";
import { SectionBadge } from "@/components/SectionBadge";
import { CommentPip } from "@/components/comments/CommentPip";
import { type CommentMarkers, NO_UID_REASON, flashClass } from "@/components/comments/markers";
import { hiddenCounts, markSections, shownAnchorUids } from "@/components/comments/section-marks";
import { CONFLICT_MARKERS_REASON } from "@/components/SectionMenu";
import { SectionSummary } from "@/components/SectionSummary";
import { SummaryControl } from "@/components/SummaryControl";
import { sharedPreviewRenderer } from "@/preview/renderer";
import { cn } from "@/lib/utils";

const noSubscribe = () => () => {};
const emptyEntries: ReadonlyMap<string, SummaryEntry> = new Map();
const noEntries = () => emptyEntries;

/** Split view renders wait this long after the last keystroke. */
export const PREVIEW_DEBOUNCE = 250;

const renderer = sharedPreviewRenderer;

/** Resolves a relative link to another Markdown file, or returns `undefined`. */
export function resolveDocumentLink(href: string, currentFile: string): { path: string; hash: string } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("#")) return undefined;
  const [pathPart = "", hash = ""] = href.split("#", 2);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return undefined;
  }
  const folder = parentPath(currentFile);
  const segments: string[] = folder === "" ? [] : folder.split("/");
  for (const segment of decoded.split("/")) {
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else if (segment !== "." && segment !== "") segments.push(segment);
  }
  try {
    const path = normalizePath(segments.join("/"));
    return isMarkdownFile(path) ? { path, hash } : undefined;
  } catch {
    return undefined;
  }
}

/** The IDs of the section anchors marked in a tree, as one key. */
function sectionAnchorKey(tree: Root): string {
  const ids: string[] = [];
  const visit = (node: Root | RootContent) => {
    if (node.type === "element" && node.properties.dataSectionAnchor !== undefined) ids.push(`${String(node.properties.id)}/${String(node.properties.dataUid)}`);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);
  return ids.join(" ");
}

/** Whether a tree holds an element with this (prefixed) `id`. */
function hasElementId(node: Root | RootContent, id: string): boolean {
  if (node.type === "element" && node.properties.id === id) return true;
  return "children" in node && node.children.some((child) => hasElementId(child, id));
}

/** The summaries in the preview: the slider's position, the saved text they are made from, and the store. */
export interface PreviewSummaries {
  /** Whether summaries can be made; when not, `problem` says why and the slider is disabled. */
  enabled: boolean;
  problem?: string;
  /** The body as last saved: summaries are made from it, never from unsaved text. */
  savedBody: string;
  /** The slider position as steps from the full text (0 is the full text). */
  steps: number;
  onStepsChange: (steps: number) => void;
  store: SummaryStore;
}

/** The preview's tint for highlighted and flashing sections, by their blocks' marks (decision D4). */
function highlightRules(comments: CommentMarkers): string {
  const selector = (uids: readonly string[]) => uids.map((uid) => `[data-testid="preview"] [data-section-uid="${CSS.escape(uid)}"]`).join(", ");
  const rules: string[] = [];
  if (comments.highlight !== null && comments.highlight.length > 0) rules.push(`${selector(comments.highlight)} { background-color: var(--comment-highlight); }`);
  if (comments.flash !== null && comments.flash.uids.length > 0) {
    const name = flashClass(comments.flash);
    rules.push(`${selector(comments.flash.uids)} { animation: ${name} 1.2s ease-out; }`);
    rules.push(`@media (prefers-reduced-motion: reduce) { ${selector(comments.flash.uids)} { animation: none; background-color: var(--comment-highlight); } }`);
  }
  return rules.join("\n");
}

/** A section the preview shows as a summary. */
interface ShownSummary {
  section: SummarizedSection;
  key: string;
  outOfDate: boolean;
}

/**
 * A request to scroll to a section, by its section ID (and UID, when known) or (for a citation of a
 * section without one) by its heading's outline path; `request` changes for each new request.
 */
export type ScrollTarget = { request: number } & ({ sectionId: string; uid?: string } | { outlinePath: string });

export interface PreviewProps {
  markdown: string;
  currentFile: string;
  /** Opens another document; `hash` is the link's fragment (a section ID), if any. */
  onOpenFile: (path: string, hash?: string) => void;
  /** Loads a document's sections, for the badges' tooltips and problems. */
  loadSections?: (path: string) => Promise<SectionInfo[]>;
  /** Changes when the file was saved, so the badges' problems are loaded again. */
  savedVersion?: string;
  /** Renumbers one occurrence of a duplicate ID in the current file. */
  onRenumber?: (id: string, uid: string | null) => void;
  /** The status lists for the file; without them badges show no status and offer only copying. */
  statusLists?: SectionStatusLists;
  /** Sets a section's status in the open file (`null`: inherited); returns an error message, or `null`. */
  onSetStatus?: (id: string, uid: string | null, status: string | null) => string | null;
  /** Called when a badge's menu opens, to load the status lists again. */
  onStatusMenu?: () => void;
  scrollTarget?: ScrollTarget;
  /** Comment threads: pips, highlighting and the badge menu's comment items (Step 012). */
  comments?: CommentMarkers;
  /** Summaries; without them the preview always shows the full text. */
  summaries?: PreviewSummaries;
  /** Where the preview's top is, as it scrolls (Step 012, R7.7; Step 016, R6). */
  onTopPosition?: (position: TopPosition) => void;
  /** The sections the preview shows summarized, whenever they change (Step 016, R7). */
  onSummarized?: (summarized: readonly SummarizedSection[]) => void;
  /** Delay before rendering changes; 0 renders at once. */
  debounce?: number;
  className?: string;
}

export function Preview({
  markdown,
  currentFile,
  onOpenFile,
  loadSections,
  savedVersion,
  onRenumber,
  statusLists,
  onSetStatus,
  onStatusMenu,
  scrollTarget,
  comments,
  summaries,
  debounce = 0,
  className,
  onTopPosition,
  onSummarized,
}: PreviewProps) {
  // The tree with the text it was rendered from, whose offsets it holds
  const [rendered, setRendered] = useState<{ tree: Root; markdown: string } | null>(null);
  const tree = rendered?.tree ?? null;
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const scrolled = useRef<number | null>(null);

  useEffect(() => {
    const request = ++latest.current;
    const run = () =>
      renderer()
        .render(markdown)
        .then((result) => {
          // Drop results for text that has since changed
          if (request !== latest.current) return;
          setRendered({ tree: result, markdown });
          setError(null);
        })
        .catch((err: Error) => request === latest.current && setError(err.message));
    if (debounce === 0 || tree === null) {
      void run();
      return;
    }
    const timer = setTimeout(run, debounce);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, debounce]);

  // The server's view of the sections, for problems: loaded when the anchors or the saved file change
  const anchorKey = useMemo(() => (tree === null ? "" : sectionAnchorKey(tree)), [tree]);
  useEffect(() => {
    if (loadSections === undefined || anchorKey === "") return;
    let current = true;
    loadSections(currentFile)
      .then((result) => current && setSections(result))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [loadSections, currentFile, anchorKey, savedVersion]);

  // Statuses of the text shown, for the badges
  const statuses = useMemo(
    () => (rendered === null || statusLists === undefined ? [] : statusesOfBody(rendered.markdown, statusLists)),
    [rendered, statusLists],
  );
  // The dialog works on the text as it is now, which may be newer than the text shown
  const latestMarkdown = useRef(markdown);
  latestMarkdown.current = markdown;
  const [attributes, setAttributes] = useState<(SectionAttributesTarget & { uid: string | null }) | null>(null);
  const openAttributes = useCallback(
    (id: string, uid: string | null) => {
      if (statusLists === undefined) return;
      const entry = findSection(statusesOfBody(latestMarkdown.current, statusLists), id, uid);
      if (entry === undefined) return;
      const title = entry.section.kind === "root" ? currentFile : entry.section.title;
      setAttributes({ id, uid, title, status: entry.status, allowed: allowedStatuses(statusLists, entry.status.prefix) });
    },
    [statusLists, currentFile],
  );
  const conflicted = useMemo(() => rendered !== null && hasConflictMarkers(rendered.markdown), [rendered]);

  // Summaries: the stops come from the text shown; the summaries from the saved text (by outline path)
  const outline = useMemo(() => (rendered === null ? null : buildOutline(rendered.markdown)), [rendered]);
  const stopCount = outline === null ? 0 : summaryStopCount(outline);
  const enabled = summaries?.enabled === true;
  const steps = summaries?.steps ?? 0;
  const stop = enabled ? Math.max(0, stopCount - 1 - steps) : stopCount - 1;
  const savedBody = summaries?.savedBody;
  const saved = useMemo(() => {
    if (savedBody === undefined || !enabled) return new Map<string, { request: SummaryRequest; simplified: string }>();
    const savedOutline = buildOutline(savedBody);
    const savedStop = Math.max(0, summaryStopCount(savedOutline) - 1 - steps);
    const byPath = new Map<string, { request: SummaryRequest; simplified: string }>();
    for (const section of summarizedAt(savedOutline, savedStop, savedBody.length)) {
      const text = savedBody.slice(section.range.from, section.range.to);
      const simplified = simplifySectionText(text);
      // Short sections are shown as written
      if (!isShortSection(simplified)) byPath.set(section.path, { request: { path: currentFile, text, headings: section.headings }, simplified });
    }
    return byPath;
  }, [savedBody, enabled, steps, currentFile]);

  const store = summaries?.store;
  useEffect(() => {
    if (store === undefined) return;
    store.need([...saved.values()].map((entry) => entry.request));
  }, [store, saved]);
  // Nothing is needed once the preview closes (another file, another view)
  useEffect(() => (store === undefined ? undefined : () => store.need([])), [store]);
  const entries = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.get ?? noEntries);

  const shown = useMemo(() => {
    const result = new Map<string, ShownSummary>();
    if (rendered === null || outline === null) return result;
    for (const section of summarizedAt(outline, stop, rendered.markdown.length)) {
      const savedSection = saved.get(section.path);
      // A section not saved yet, or short, is shown as written
      if (savedSection === undefined) continue;
      const current = simplifySectionText(rendered.markdown.slice(section.range.from, section.range.to));
      if (isShortSection(current)) continue;
      result.set(section.path, { section, key: summaryKey(savedSection.request), outOfDate: current !== savedSection.simplified });
    }
    return result;
  }, [rendered, outline, stop, saved]);

  const marking = comments !== undefined;
  const shownTree = useMemo(() => {
    if (rendered === null || outline === null) return null;
    const summarized = summarizeTree(rendered.tree, rendered.markdown, outline, [...shown.values()].map((entry) => entry.section));
    // Blocks marked with their sections, for highlighting from comment threads
    return marking ? markSections(summarized, rendered.markdown) : summarized;
  }, [rendered, outline, shown, marking]);

  // The threads of sections the summary slider hides, counted on their nearest shown ancestor (R5.6)
  const counts = comments?.counts;
  const hidden = useMemo(
    () => (shownTree === null || rendered === null || counts === undefined || shown.size === 0 ? new Map<string, number>() : hiddenCounts(rendered.markdown, shownAnchorUids(shownTree), counts)),
    [shownTree, rendered, counts, shown],
  );

  // A click on a summary shows the full text and scrolls to its section
  const [outlineScroll, setOutlineScroll] = useState<{ path: string; request: number } | null>(null);
  const onStepsChange = summaries?.onStepsChange;
  const showFullText = useCallback(
    (path: string) => {
      setOutlineScroll({ path, request: Date.now() });
      onStepsChange?.(0);
    },
    [onStepsChange],
  );

  // The link component keeps its identity, so badges (and their open menus) aren't remounted
  // when statuses or problems change; it reads what changes from here when it renders
  const current = { sections, statuses, statusLists, onSetStatus, conflicted, currentFile, loadSections, onRenumber, openAttributes, onStatusMenu, onOpenFile, comments, hidden };
  const linkData = useRef(current);
  linkData.current = current;
  const Link = useMemo(
    () =>
      function Link({ href, children, ...props }: ComponentProps<"a"> & { node?: unknown; "data-section-anchor"?: string; "data-uid"?: string }) {
        const { sections, statuses, statusLists, onSetStatus, conflicted, currentFile, loadSections, onRenumber, openAttributes, onStatusMenu, onOpenFile, comments, hidden } =
          linkData.current;
        delete props.node;
        if (props["data-section-anchor"] !== undefined && typeof props.id === "string") {
          // The anchor stays (invisible) as the scroll target; the badge stands for it
          const id = props.id.slice(CLOBBER_PREFIX.length);
          const uid = props["data-uid"];
          const info = sections.find((section) => section.id === id && (uid === undefined || section.uid === uid));
          const status = findSection(statuses, id, uid)?.status;
          const editable = statusLists?.sectioned === true && onSetStatus !== undefined;
          const count = uid === undefined ? 0 : (comments?.counts.get(uid) ?? 0);
          const hiddenCount = uid === undefined ? 0 : (hidden.get(uid) ?? 0);
          const commentItems =
            comments?.available !== true
              ? {}
              : {
                  ...(uid === undefined
                    ? { onAddComment: () => undefined, addCommentDisabled: NO_UID_REASON }
                    : { onAddComment: () => comments.onAddComment(uid), ...(comments.addDisabled === undefined ? {} : { addCommentDisabled: comments.addDisabled }) }),
                  ...(uid !== undefined && comments.withThreads.has(uid) ? { onShowComments: () => comments.onPip(uid) } : {}),
                };
          return (
            <>
              <a {...props} />
              <SectionBadge
                sectionId={id}
                {...(uid === undefined ? {} : { uid })}
                path={currentFile}
                {...(status === undefined ? {} : { status: badgeStatus(status) })}
                loadSections={loadSections}
                problem={info?.problem}
                {...(onRenumber === undefined ? {} : { onRenumber: () => onRenumber(id, uid ?? null) })}
                {...(editable ? { onAttributes: () => openAttributes(id, uid ?? null) } : {})}
                {...(editable && conflicted ? { attributesDisabled: CONFLICT_MARKERS_REASON } : {})}
                {...(onStatusMenu === undefined ? {} : { onMenuOpen: onStatusMenu })}
                {...commentItems}
              />
              {comments !== undefined && uid !== undefined && count + hiddenCount > 0 && (
                <CommentPip
                  sectionUid={uid}
                  count={count + hiddenCount}
                  hidden={hiddenCount}
                  filter={comments.filter}
                  previews={comments.previews.get(uid) ?? []}
                  onPip={comments.onPip}
                  onPipHover={comments.onPipHover}
                />
              )}
            </>
          );
        }
        if (href === undefined) return <a {...props}>{children}</a>;
        if (href.startsWith("#")) return <a href={href} {...props}>{children}</a>;
        const target = resolveDocumentLink(href, currentFile);
        if (target !== undefined) {
          return (
            <a
              href={href}
              {...props}
              onClick={(event) => {
                event.preventDefault();
                onOpenFile(target.path, target.hash === "" ? undefined : decodeURIComponent(target.hash));
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      },
    [],
  );

  const content = useMemo(() => {
    if (shownTree === null) return null;
    const Summary = (props: { "data-path"?: string }) => {
      const path = props["data-path"] ?? "";
      const info = shown.get(path);
      if (info === undefined || store === undefined) return null;
      return (
        <SectionSummary
          entry={entries.get(info.key)}
          outOfDate={info.outOfDate}
          onRetry={() => store.retry(info.key)}
          onShowFullText={() => showFullText(path)}
        />
      );
    };
    const components = { a: Link, [SUMMARY_TAG]: Summary } as unknown as Partial<Components>;
    return toJsxRuntime(shownTree, { Fragment, jsx, jsxs, components }) as ReactNode;
  }, [
    Link,
    shownTree,
    shown,
    entries,
    store,
    showFullText,
    currentFile,
    onOpenFile,
    loadSections,
    sections,
    onRenumber,
    statuses,
    statusLists,
    onSetStatus,
    onStatusMenu,
    openAttributes,
    conflicted,
    comments,
    hidden,
  ]);

  // Where the top is, as the preview scrolls: the section, and the heading by its outline path
  useEffect(() => {
    const element = container.current;
    if (element === null || onTopPosition === undefined) return;
    const pathAttribute = OUTLINE_PATH_PROPERTY.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    let frame = 0;
    const report = () => {
      frame = 0;
      const top = element.getBoundingClientRect().top + 4;
      let uid: string | null = null;
      for (const anchor of element.querySelectorAll<HTMLElement>("a[data-section-anchor][data-uid]")) {
        // The anchor itself is hidden; its badge is where it shows
        const shown = (anchor.nextElementSibling as HTMLElement | null) ?? anchor;
        if (shown.getBoundingClientRect().top > top) break;
        uid = anchor.dataset.uid ?? null;
      }
      let outlinePath: string | null = null;
      for (const heading of element.querySelectorAll<HTMLElement>(`[${pathAttribute}]`)) {
        if (heading.getBoundingClientRect().top > top) break;
        outlinePath = heading.getAttribute(pathAttribute);
      }
      onTopPosition({ uid, outlinePath });
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(report);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [onTopPosition]);

  // The sections shown summarized, for the Outline (Step 016, R7): those the stop summarizes
  // that the preview really replaces (not short ones, nor ones not saved yet)
  useEffect(() => {
    onSummarized?.([...shown.values()].map((entry) => entry.section));
  }, [shown, onSummarized]);
  useEffect(() => (onSummarized === undefined ? undefined : () => onSummarized([])), [onSummarized]);

  // Scroll to a requested section once it has been rendered; a section hidden by a summary
  // shows the full text first
  useEffect(() => {
    if (scrollTarget === undefined || scrolled.current === scrollTarget.request || content === null || tree === null) return;
    if (!("sectionId" in scrollTarget)) {
      // By outline path: the heading if it is shown; else the full text first; else the top
      scrolled.current = scrollTarget.request;
      const property = OUTLINE_PATH_PROPERTY.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const heading = scrollTarget.outlinePath === "" ? null : container.current?.querySelector(`[${property}="${scrollTarget.outlinePath}"]`);
      if (heading !== null && heading !== undefined) heading.scrollIntoView({ block: "start" });
      else if (scrollTarget.outlinePath !== "" && stop < stopCount - 1) {
        setOutlineScroll({ path: scrollTarget.outlinePath, request: scrollTarget.request });
        onStepsChange?.(0);
      } else container.current?.scrollTo({ top: 0 });
      return;
    }
    const id = `${CLOBBER_PREFIX}${scrollTarget.sectionId}`;
    const target = container.current?.querySelector(`[id="${id}"]`);
    if (target === null || target === undefined) {
      if (stop < stopCount - 1 && hasElementId(tree, id)) onStepsChange?.(0);
      return;
    }
    scrolled.current = scrollTarget.request;
    target.scrollIntoView({ block: "start" });
  }, [content, tree, scrollTarget, stop, stopCount, onStepsChange]);

  useEffect(() => {
    if (outlineScroll === null || content === null || stop < stopCount - 1) return;
    setOutlineScroll(null);
    if (outlineScroll.path === "") {
      container.current?.scrollTo({ top: 0 });
      return;
    }
    const property = OUTLINE_PATH_PROPERTY.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    container.current?.querySelector(`[${property}="${outlineScroll.path}"]`)?.scrollIntoView({ block: "start" });
  }, [content, outlineScroll, stop, stopCount]);

  const names = useMemo(() => (outline === null ? [] : Array.from({ length: stopCount }, (_, i) => summaryStopName(outline, i))), [outline, stopCount]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} data-testid="preview">
      {summaries !== undefined && stopCount > 0 && (
        <SummaryControl
          count={stopCount}
          stop={stop}
          names={names}
          onChange={(next) => summaries.onStepsChange(stopCount - 1 - next)}
          {...(summaries.enabled ? {} : { problem: summaries.problem ?? "Summaries aren't enabled." })}
        />
      )}
      <div ref={container} className="min-h-0 flex-1 overflow-auto">
        {comments !== undefined && <style>{highlightRules(comments)}</style>}
        {error !== null && <p className="text-error-text p-4">Preview failed: {error}</p>}
        <article className="markdown px-6 py-4">{content}</article>
      </div>
      <SectionAttributesDialog
        target={attributes}
        onClose={() => setAttributes(null)}
        onApply={(status) => (attributes === null || onSetStatus === undefined ? null : onSetStatus(attributes.id, attributes.uid, status))}
      />
    </div>
  );
}
