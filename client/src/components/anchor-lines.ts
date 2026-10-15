import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, Selection, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { anchorTagSectionId, isAnchorCloseTag } from "@specquer/shared/markdown";

/**
 * Section anchors in the WYSIWYG view, laid out like the preview's. In Markdown a heading's
 * anchor is on the line above it, which Milkdown keeps as a paragraph of its own; shown as is,
 * its badge sits a paragraph (and a heading margin) above the heading, at body-text size. This
 * plugin marks such paragraphs (`section-anchor-line`) and, when a heading follows, the heading's
 * level (`data-before-heading`), so the stylesheet can collapse the paragraph and float its badge
 * into the heading's first line at the heading's size. The document and the saved Markdown don't
 * change. The cursor skips collapsed paragraphs, so text is never typed beside a hidden anchor:
 * arrow keys move past them at once, and any other selection that lands in one is moved out.
 */

export const ANCHOR_LINE_CLASS = "section-anchor-line";

/** Whether a paragraph holds only section anchors (their open tags with section IDs, and closing tags). */
export function isAnchorLine(node: Node): boolean {
  if (node.type.name !== "paragraph" || node.childCount === 0) return false;
  let hasAnchor = false;
  let only = true;
  node.forEach((child) => {
    if (child.type.name === "text" && (child.text ?? "").trim() === "") return;
    const value = child.type.name === "html" ? String(child.attrs.value ?? "") : undefined;
    if (value !== undefined && anchorTagSectionId(value) !== undefined) hasAnchor = true;
    else if (value === undefined || !isAnchorCloseTag(value)) only = false;
  });
  return hasAnchor && only;
}

/** The anchor-only paragraphs among the document's top-level blocks: position, size and the level of a heading right after it. */
export function anchorLines(doc: Node): Array<{ from: number; to: number; headingLevel?: number }> {
  const lines: Array<{ from: number; to: number; headingLevel?: number }> = [];
  doc.forEach((node, offset, index) => {
    if (!isAnchorLine(node)) return;
    const next = index + 1 < doc.childCount ? doc.child(index + 1) : null;
    const level = next?.type.name === "heading" ? Number(next.attrs.level) : undefined;
    lines.push({ from: offset, to: offset + node.nodeSize, ...(level === undefined ? {} : { headingLevel: level }) });
  });
  return lines;
}

function decorations(doc: Node): DecorationSet {
  return DecorationSet.create(
    doc,
    anchorLines(doc).map((line) =>
      Decoration.node(line.from, line.to, {
        class: ANCHOR_LINE_CLASS,
        ...(line.headingLevel === undefined ? {} : { "data-before-heading": String(line.headingLevel) }),
      }),
    ),
  );
}

/**
 * Where the cursor goes when it lands in a collapsed paragraph (one before a heading): on past
 * it in the direction it was moving, or the other way at the edge of the document.
 */
export function skipCollapsed(doc: Node, position: number, movingBack: boolean): number | undefined {
  const line = anchorLines(doc).find((found) => found.headingLevel !== undefined && found.from < position && position < found.to);
  if (line === undefined) return undefined;
  const before = Selection.findFrom(doc.resolve(line.from), -1, true);
  const after = Selection.findFrom(doc.resolve(line.to), 1, true);
  const target = movingBack ? (before ?? after) : (after ?? before);
  return target?.from;
}

/**
 * Where an arrow key that leaves the cursor's textblock should put the cursor, when it would land
 * in a collapsed paragraph: past it, as `skipCollapsed` would, or `undefined` when it wouldn't
 * land in one. `back` is up or left. The cursor's textblock must be the first (moving back) or the
 * last (moving forward) of its top-level block, since only leaving that block reaches the next one.
 */
export function arrowTarget(doc: Node, position: number, back: boolean): number | undefined {
  const $pos = doc.resolve(position);
  if ($pos.depth < 1 || !$pos.parent.isTextblock) return undefined;
  const edge = Selection.findFrom(doc.resolve(back ? $pos.before(1) : $pos.after(1)), back ? 1 : -1, true);
  if (edge === null || edge.$from.start() !== $pos.start()) return undefined;
  // Just across the block's boundary: the end of the block before, or the start of the block after
  const across = back ? $pos.before(1) - 1 : $pos.after(1) + 1;
  if (across < 0 || across > doc.content.size) return undefined;
  return skipCollapsed(doc, across, back);
}

const ARROWS: Record<string, "up" | "down" | "left" | "right"> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/**
 * The cursor as the browser has it now, as a document position. ProseMirror reads the DOM
 * selection a moment after it changes, so right after a click or a key such as Home its own
 * selection can still be an earlier one.
 */
function domCursor(view: EditorView): number | undefined {
  const selection = (view.root as Document).getSelection?.();
  if (selection === null || selection === undefined || !selection.isCollapsed || selection.focusNode === null) return undefined;
  if (!view.dom.contains(selection.focusNode)) return undefined;
  try {
    return view.posAtDOM(selection.focusNode, selection.focusOffset);
  } catch {
    return undefined;
  }
}

const key = new PluginKey("section-anchor-lines");

export function anchorLinesPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => decorations(state.doc),
      apply: (tr, previous) => (tr.docChanged ? decorations(tr.doc) : previous),
    },
    props: {
      decorations: (state) => key.getState(state) as DecorationSet,
      // An arrow key that would move into a collapsed paragraph moves past it here, at once. Left
      // to the browser, the caret enters the paragraph first and ProseMirror reads that later: a
      // key typed meanwhile lands beside the hidden anchor, and the direction worked out from a
      // selection read late can be the wrong one.
      handleKeyDown: (view, event) => {
        const direction = ARROWS[event.key];
        if (direction === undefined || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
        const { selection, doc } = view.state;
        const at = domCursor(view) ?? (selection instanceof TextSelection && selection.empty ? selection.from : undefined);
        if (at === undefined) return false;
        const cursor = TextSelection.near(doc.resolve(at));
        if (!cursor.empty || cursor.from !== at) return false;
        const target = arrowTarget(doc, at, direction === "up" || direction === "left");
        if (target === undefined) return false;
        // Whether the key leaves the textblock (up from its first line, say), at the cursor the browser has
        if (!view.endOfTextblock(direction, view.state.apply(view.state.tr.setSelection(cursor)))) return false;
        view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(target))).scrollIntoView());
        return true;
      },
    },
    appendTransaction: (transactions, oldState, newState) => {
      if (!transactions.some((tr) => tr.selectionSet)) return null;
      const selection = newState.selection;
      if (!(selection instanceof TextSelection) || !selection.empty) return null;
      const target = skipCollapsed(newState.doc, selection.from, selection.from < oldState.selection.from);
      return target === undefined ? null : newState.tr.setSelection(TextSelection.near(newState.doc.resolve(target)));
    },
  });
}
