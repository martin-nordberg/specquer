import type { Node } from "@milkdown/kit/prose/model";
import { type EditorState, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { anchorTagSectionId, anchorTagUid } from "@specquer/shared/markdown";
import { type CommentMarkers, flashClass, pipElement } from "./markers";

/**
 * Comment pips and highlights in the WYSIWYG view (Step 012, decision D3). The section badges are
 * node views built once per anchor, so the pips are widget decorations after them, and the
 * highlight is a class on the highlighted sections' blocks; both come from this plugin's state,
 * which the editor sets with a transaction that changes nothing in the document or its history.
 */

type Markers = Pick<CommentMarkers, "counts" | "previews" | "filter" | "highlight" | "flash" | "onPip" | "onPipHover">;

interface DecorationState {
  markers: Markers | null;
  decorations: DecorationSet;
}

export const commentDecorationsKey = new PluginKey<DecorationState>("comment-decorations");

const LISTS = new Set(["bullet_list", "ordered_list"]);

/** A section anchor's UID, if the node is one's open tag. */
function anchorUid(node: Node): string | undefined {
  if (node.type.name !== "html") return undefined;
  const value = String(node.attrs.value ?? "");
  return anchorTagSectionId(value) === undefined ? undefined : anchorTagUid(value);
}

/** The UID of the first section anchor in a node. */
function firstAnchor(node: Node): string | undefined {
  let found: string | undefined;
  node.descendants((child) => {
    if (found !== undefined) return false;
    found = anchorUid(child);
    return found === undefined;
  });
  return found;
}

/**
 * Calls `visit` with each top-level block and the UID of the heading section it belongs to (the
 * last root or heading anchor before or in it; anchors in lists are list items' own), and each
 * list item that is a section with its UID.
 */
function walkSections(doc: Node, visit: (node: Node, pos: number, uid: string | null, item: boolean) => void): void {
  let current: string | null = null;
  doc.forEach((node, offset) => {
    if (LISTS.has(node.type.name)) {
      visit(node, offset, current, false);
      node.descendants((child, pos) => {
        if (child.type.name !== "list_item") return true;
        // A list item's anchor is at the start of its first paragraph
        const uid = child.firstChild === null ? undefined : firstAnchor(child.firstChild);
        if (uid !== undefined) visit(child, offset + 1 + pos, uid, true);
        return true;
      });
      return;
    }
    node.descendants((child) => {
      const uid = anchorUid(child);
      if (uid !== undefined) current = uid;
      return true;
    });
    visit(node, offset, current, false);
  });
}

function decorate(doc: Node, markers: Markers | null): DecorationSet {
  if (markers === null) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  const highlight = markers.highlight === null ? null : new Set(markers.highlight);
  const flash = markers.flash === null ? null : new Set(markers.flash.uids);
  doc.descendants((node, pos) => {
    const uid = anchorUid(node);
    const count = uid === undefined ? 0 : (markers.counts.get(uid) ?? 0);
    if (uid === undefined || count === 0) return true;
    const previews = markers.previews.get(uid) ?? [];
    decorations.push(
      Decoration.widget(
        pos + node.nodeSize,
        () => pipElement({ sectionUid: uid, count, filter: markers.filter, previews, onPip: markers.onPip, onPipHover: markers.onPipHover }),
        { side: 1, key: `comment-pip:${uid}:${count}:${markers.filter}:${previews.join("\u0000")}`, ignoreSelection: true, stopEvent: () => true },
      ),
    );
    return false;
  });
  if (highlight !== null || flash !== null) {
    walkSections(doc, (node, pos, uid) => {
      if (uid === null) return;
      const classes = [highlight?.has(uid) === true ? "comment-highlight" : "", flash?.has(uid) === true ? flashClass(markers.flash!) : ""].filter((c) => c !== "");
      // A list takes its heading section's tint, and its items that are sections their own
      if (classes.length > 0) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: classes.join(" ") }));
    });
  }
  return DecorationSet.create(doc, decorations);
}

export function commentDecorationsPlugin(): Plugin<DecorationState> {
  return new Plugin<DecorationState>({
    key: commentDecorationsKey,
    state: {
      init: () => ({ markers: null, decorations: DecorationSet.empty }),
      apply(tr, value, _old, state) {
        const markers = tr.getMeta(commentDecorationsKey) as Markers | null | undefined;
        if (markers !== undefined) return { markers, decorations: decorate(state.doc, markers) };
        return tr.docChanged ? { markers: value.markers, decorations: decorate(state.doc, value.markers) } : value;
      },
    },
    props: {
      decorations: (state: EditorState) => commentDecorationsKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  });
}

/** Gives the plugin new markers, outside the document and its undo history. */
export function setCommentMarkers(view: EditorView, markers: Markers | null): void {
  view.dispatch(view.state.tr.setMeta(commentDecorationsKey, markers).setMeta("addToHistory", false));
}

/** The UID of the heading section a document position is in, if any. */
export function sectionAtPos(doc: Node, pos: number): string | null {
  let found: string | null = null;
  walkSections(doc, (node, start, uid, item) => {
    if (!item && start <= pos) found = uid;
  });
  return found;
}
