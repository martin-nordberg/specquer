import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark, htmlSchema } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Fragment, type Node, Slice } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose, $view } from "@milkdown/kit/utils";
import { useEffect, useRef, useState } from "react";
import type { SectionStatusLists } from "@specquer/shared/api";
import {
  type TopPosition,
  anchorTagSectionId,
  anchorTagStatus,
  anchorTagUid,
  hasConflictMarkers,
  isAnchorCloseTag,
  outlineHeadings,
  withStatus,
} from "@specquer/shared/markdown";
import { bodySections } from "@/app/body-sections";
import { type SectionWithStatus, allowedStatuses, badgeStatus, findSection, hasInvalidOwnStatus, statusLabel, statusesOfBody } from "@/app/section-status";
import { SectionAttributesDialog, type SectionAttributesTarget } from "@/components/SectionAttributesDialog";
import { anchorLinesPlugin } from "@/components/anchor-lines";
import type { ScrollTarget } from "@/components/Preview";
import { commentDecorationsPlugin, sectionAtPos, setCommentMarkers } from "@/components/comments/comment-decorations";
import { type CommentMarkers, NO_UID_REASON } from "@/components/comments/markers";
import { badgeLabel } from "@/components/SectionBadge";
import { CONFLICT_MARKERS_REASON, SectionMenu, type SectionMenuTarget, isMenuKey } from "@/components/SectionMenu";
import { cn } from "@/lib/utils";
import { faviconSvg, svgDataUri } from "@/theme/logo";

const badgeUri = svgDataUri(faviconSvg);

/** Events on a badge that ProseMirror leaves alone. */
const BADGE_EVENTS = new Set(["contextmenu", "mousedown", "mouseup", "pointerdown", "pointerup", "click", "dblclick"]);

/** What the badges need from the editor: the section's status now, and opening the menu. */
interface BadgeHandlers {
  /** The status of the section with this ID and UID in the Markdown as it is now, if known. */
  statusOf: (id: string, uid: string | undefined) => SectionWithStatus | undefined;
  lists: () => SectionStatusLists | undefined;
  openMenu: (target: SectionMenuTarget & { uid: string | undefined; view: EditorView; pos: number | undefined }) => void;
}

/**
 * Shows section anchors as badges. Milkdown keeps raw HTML as atomic `html` nodes and writes
 * them back unchanged, so the anchors survive editing; this only changes how they look: an
 * anchor's open tag becomes the badge and its closing tag disappears. Other raw HTML still shows
 * as text. The badge is focusable; its `title` holds the section ID and status, worked out when
 * it is shown (a node view isn't rebuilt when a parent section's anchor changes), and
 * right-click, the context-menu key or Shift+F10 open its menu.
 */
function sectionAnchorView(handlers: BadgeHandlers) {
  return $view(htmlSchema.node, () => (node, view, getPos) => {
    const value = String(node.attrs.value ?? "");
    const dom = document.createElement("span");
    dom.dataset.type = "html";
    dom.contentEditable = "false";
    const sectionId = anchorTagSectionId(value);
    if (sectionId !== undefined) {
      const uid = anchorTagUid(value);
      const lists = handlers.lists();
      const invalid = lists !== undefined && hasInvalidOwnStatus(sectionId, anchorTagStatus(value), lists);
      dom.className = cn("section-badge", invalid && "section-badge-problem");
      dom.dataset.sectionId = sectionId;
      dom.tabIndex = 0;
      dom.setAttribute("role", "button");
      dom.setAttribute("aria-haspopup", "menu");
      const describe = () => {
        const entry = handlers.statusOf(sectionId, uid);
        const status = entry === undefined ? undefined : badgeStatus(entry.status);
        dom.title = status === undefined ? sectionId : `${sectionId} - ${statusLabel(status)}`;
        dom.setAttribute("aria-label", badgeLabel(sectionId, status, false));
      };
      describe();
      dom.addEventListener("mouseenter", describe);
      dom.addEventListener("focus", describe);
      const open = (x: number, y: number) => handlers.openMenu({ x, y, sectionId, uid, returnFocus: dom, view, pos: getPos() });
      dom.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        open(event.clientX, event.clientY);
      });
      dom.addEventListener("keydown", (event) => {
        if (!isMenuKey(event)) return;
        event.preventDefault();
        const rect = dom.getBoundingClientRect();
        open(rect.left, rect.bottom);
      });
      const img = document.createElement("img");
      img.src = badgeUri;
      img.alt = "";
      dom.append(img);
      return {
        dom,
        ignoreMutation: () => true,
        // The badge's own events aren't editing: ProseMirror would select the node and take the
        // focus back from the menu
        stopEvent: (event: Event) => BADGE_EVENTS.has(event.type) || (event.type === "keydown" && isMenuKey(event as KeyboardEvent)),
      };
    }
    const position = getPos();
    const before = position === undefined ? null : view.state.doc.resolve(position).nodeBefore;
    const closesSectionAnchor =
      isAnchorCloseTag(value) && before?.type.name === "html" && anchorTagSectionId(String(before.attrs.value ?? "")) !== undefined;
    if (closesSectionAnchor) dom.hidden = true;
    else dom.textContent = value;
    return { dom, ignoreMutation: () => true };
  });
}

/** The position of a section anchor's open tag in the editor's document: at `pos` if it is still there, else found by ID and UID. */
/**
 * The positions of the document's top-level headings, in order. Headings inside lists and block
 * quotes aren't in the heading outline, so the n-th of these is the outline's n-th heading.
 */
function headingPositions(doc: Node): number[] {
  const positions: number[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === "heading") positions.push(offset);
  });
  return positions;
}

function anchorPosition(view: EditorView, sectionId: string, uid: string | undefined, pos: number | undefined): number | undefined {
  const matches = (node: Node | null | undefined) => {
    if (node?.type.name !== "html") return false;
    const value = String(node.attrs.value ?? "");
    return anchorTagSectionId(value) === sectionId && (uid === undefined || anchorTagUid(value) === uid);
  };
  if (pos !== undefined && matches(view.state.doc.nodeAt(pos))) return pos;
  let found: number | undefined;
  view.state.doc.descendants((node, at) => {
    if (found !== undefined) return false;
    if (matches(node)) found = at;
    return true;
  });
  return found;
}

/** The section IDs of the anchors in a document or fragment. */
function sectionIdsIn(node: Node | Fragment): Set<string> {
  const ids = new Set<string>();
  node.descendants((child) => {
    if (child.type.name !== "html") return true;
    const id = anchorTagSectionId(String(child.attrs.value ?? ""));
    if (id !== undefined) ids.add(id);
    return false;
  });
  return ids;
}

/** The fragment with the open tags of anchors whose IDs are taken turned into placeholders. */
function withPlaceholders(fragment: Fragment, taken: ReadonlySet<string>): Fragment {
  const nodes: Node[] = [];
  fragment.forEach((node) => {
    if (node.type.name === "html") {
      const id = anchorTagSectionId(String(node.attrs.value ?? ""));
      nodes.push(id !== undefined && taken.has(id) ? node.type.create({ ...node.attrs, value: '<a id="">' }) : node);
    } else nodes.push(node.isLeaf ? node : node.copy(withPlaceholders(node.content, taken)));
  });
  return Fragment.fromArray(nodes);
}

/**
 * A pasted section anchor whose ID the document already holds is a copy: it becomes a
 * placeholder, and the next save gives it a new ID (decision D4 of Step 003). Copies from other
 * documents are left to the server, which reports them.
 */
export function placeholdersForPastedCopies(slice: Slice, doc: Node): Slice {
  if (sectionIdsIn(slice.content).size === 0) return slice;
  const taken = sectionIdsIn(doc);
  return new Slice(withPlaceholders(slice.content, taken), slice.openStart, slice.openEnd);
}

/**
 * The WYSIWYG view (Milkdown). Milkdown rewrites Markdown it serializes (list markers, tables,
 * reference links), so its output is reported only after the user changes something; opening a
 * file here never changes it (decision D5). A status set from a badge's menu is a ProseMirror
 * transaction, so Milkdown's undo history has it.
 */
export interface MilkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  /** The status lists for the file; without them badges show no status and offer only copying. */
  statusLists?: SectionStatusLists;
  /** Called when a badge's menu opens, to load the status lists again. */
  onStatusMenu?: () => void;
  /**
   * Registers the function that reports pending edits at once (Milkdown reports them 200 ms after
   * the last change), so a save holds everything typed; returns the function that removes it.
   */
  registerFlush?: (flush: () => void) => () => void;
  /** Comment threads: pips, highlighting and the badge menu's comment items (Step 012). */
  comments?: CommentMarkers;
  /** A request to scroll to a section. */
  scrollTarget?: ScrollTarget;
  /** Where the view's top is, as it scrolls (Step 012, R7.7; Step 016, R6). */
  onTopPosition?: (position: TopPosition) => void;
  className?: string;
}

type MenuState = SectionMenuTarget & { uid: string | undefined; view: EditorView; pos: number | undefined; conflicted: boolean };

export function MilkdownEditor({ value, onChange, statusLists, onStatusMenu, registerFlush, comments, scrollTarget, onTopPosition, className }: MilkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const listsRef = useRef(statusLists);
  listsRef.current = statusLists;
  const onStatusMenuRef = useRef(onStatusMenu);
  onStatusMenuRef.current = onStatusMenu;
  // The Markdown as it is now, and its statuses, worked out once per text
  const markdown = useRef(value);
  const cache = useRef<{ markdown: string; lists: SectionStatusLists; entries: SectionWithStatus[] } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [ready, setReady] = useState(false);
  const [attributes, setAttributes] = useState<(SectionAttributesTarget & { uid: string | undefined; view: EditorView; pos: number | undefined }) | null>(null);

  const statusesNow = () => {
    const lists = listsRef.current;
    if (lists === undefined) return [];
    if (cache.current?.markdown !== markdown.current || cache.current.lists !== lists) {
      cache.current = { markdown: markdown.current, lists, entries: statusesOfBody(markdown.current, lists) };
    }
    return cache.current.entries;
  };

  useEffect(() => {
    let editor: Editor | null = null;
    let disposed = false;
    // The document as last reported; a document equal to it has nothing to report, so a file
    // opened here is never rewritten in Milkdown's style unless the user changes it
    let reported: Node | null = null;
    const handlers: BadgeHandlers = {
      statusOf: (id, uid) => findSection(statusesNow(), id, uid),
      lists: () => listsRef.current,
      openMenu: (target) => {
        setMenu({ ...target, conflicted: hasConflictMarkers(markdown.current) });
        onStatusMenuRef.current?.();
      },
    };
    void Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host.current!);
        ctx.set(defaultValueCtx, value);
        ctx.update(editorViewOptionsCtx, (options) => ({
          ...options,
          attributes: { class: "markdown", "aria-label": "Markdown content (WYSIWYG)", spellcheck: "true" },
          transformPasted: (slice, view) => placeholdersForPastedCopies(slice, view.state.doc),
        }));
        // Closer to the style most specs use
        ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const, rule: "-" as const }));
        ctx.get(listenerCtx).markdownUpdated((listenerContext, updated, previous) => {
          reported = listenerContext.get(editorViewCtx).state.doc;
          markdown.current = updated;
          if (updated !== previous) onChangeRef.current(updated);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(sectionAnchorView(handlers))
      .use($prose(() => anchorLinesPlugin()))
      .use($prose(() => commentDecorationsPlugin()))
      .use(history)
      .use(listener)
      .create()
      .then((created) => {
        if (disposed) void created.destroy();
        else {
          editor = created;
          const view = created.action((ctx) => ctx.get(editorViewCtx));
          reported = view.state.doc;
          viewRef.current = view;
          if (commentsRef.current !== undefined) setCommentMarkers(view, commentsRef.current);
          setReady(true);
        }
      });
    const unregister = registerFlush?.(() => {
      editor?.action((ctx) => {
        const doc = ctx.get(editorViewCtx).state.doc;
        if (reported === null || doc.eq(reported)) return;
        reported = doc;
        const updated = ctx.get(serializerCtx)(doc);
        if (updated === markdown.current) return;
        markdown.current = updated;
        onChangeRef.current(updated);
      });
    });
    return () => {
      disposed = true;
      viewRef.current = null;
      unregister?.();
      void editor?.destroy();
    };
    // The editor is created once per document revision (the parent remounts it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAttributes = () => {
    const lists = listsRef.current;
    if (menu === null || lists === undefined) return;
    const entry = findSection(statusesNow(), menu.sectionId, menu.uid);
    if (entry === undefined) return;
    setAttributes({
      id: menu.sectionId,
      uid: menu.uid,
      title: entry.section.title,
      status: entry.status,
      allowed: allowedStatuses(lists, entry.status.prefix),
      view: menu.view,
      pos: menu.pos,
    });
  };

  const apply = (status: string | null): string | null => {
    if (attributes === null) return null;
    const { view } = attributes;
    const pos = anchorPosition(view, attributes.id, attributes.uid, attributes.pos);
    if (pos === undefined) return `${attributes.id} is no longer in the file.`;
    const node = view.state.doc.nodeAt(pos)!;
    const updated = withStatus(String(node.attrs.value ?? ""), status);
    if (updated !== node.attrs.value) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value: updated }));
    return null;
  };

  // New markers for the pips and highlights
  useEffect(() => {
    const view = viewRef.current;
    if (view !== null) setCommentMarkers(view, comments ?? null);
  }, [comments, ready]);

  // Where the top is, as the view scrolls: the section, and the heading by its outline path
  useEffect(() => {
    const element = host.current;
    if (element === null || onTopPosition === undefined) return;
    let frame = 0;
    const report = () => {
      frame = 0;
      const view = viewRef.current;
      if (view === null) return;
      const rect = element.getBoundingClientRect();
      const at = view.posAtCoords({ left: rect.left + rect.width / 2, top: rect.top + 8 });
      if (at === null) return onTopPosition({ uid: null, outlinePath: null });
      const before = headingPositions(view.state.doc).filter((pos) => pos <= at.pos).length;
      const paths = outlineHeadings(bodySections(markdown.current).outline);
      onTopPosition({ uid: sectionAtPos(view.state.doc, at.pos), outlinePath: before === 0 ? null : (paths[before - 1]?.path ?? null) });
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

  // Scrolls to a requested section's anchor
  const scrolled = useRef<number | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    const element = host.current;
    if (scrollTarget === undefined || view === null || element === null || scrolled.current === scrollTarget.request) return;
    let pos: number | undefined;
    if ("sectionId" in scrollTarget) pos = anchorPosition(view, scrollTarget.sectionId, scrollTarget.uid, undefined);
    else {
      // A heading by its outline path (Step 016, R5.1)
      const index = outlineHeadings(bodySections(markdown.current).outline).findIndex((heading) => heading.path === scrollTarget.outlinePath);
      pos = index < 0 ? undefined : headingPositions(view.state.doc)[index];
    }
    if (pos === undefined) return;
    scrolled.current = scrollTarget.request;
    const top = view.coordsAtPos(pos).top - element.getBoundingClientRect().top;
    element.scrollTo({ top: element.scrollTop + top - 8 });
  }, [scrollTarget, ready]);

  const commentItems = (() => {
    if (comments?.available !== true || menu === null) return {};
    const uid = menu.uid;
    if (uid === undefined) return { onAddComment: () => undefined, addCommentDisabled: NO_UID_REASON };
    return {
      onAddComment: () => comments.onAddComment(uid),
      ...(comments.addDisabled === undefined ? {} : { addCommentDisabled: comments.addDisabled }),
      ...(comments.withThreads.has(uid) ? { onShowComments: () => comments.onPip(uid) } : {}),
    };
  })();

  const sectioned = statusLists?.sectioned === true;
  return (
    <>
      <div ref={host} className={cn("milkdown h-full overflow-auto", className)} data-testid="wysiwyg" />
      <SectionMenu
        target={menu}
        onClose={() => setMenu(null)}
        onCopy={(sectionId) => void navigator.clipboard?.writeText(sectionId).catch(() => undefined)}
        {...(sectioned ? { onAttributes: openAttributes } : {})}
        {...(sectioned && menu?.conflicted === true ? { attributesDisabled: CONFLICT_MARKERS_REASON } : {})}
        {...commentItems}
      />
      <SectionAttributesDialog target={attributes} onClose={() => setAttributes(null)} onApply={apply} />
    </>
  );
}
