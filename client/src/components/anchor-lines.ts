import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, Selection, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { anchorTagSectionId, isAnchorCloseTag } from "@specquer/shared/markdown";

/**
 * Section anchors in the WYSIWYG view, laid out like the preview's. In Markdown a heading's
 * anchor is on the line above it, which Milkdown keeps as a paragraph of its own; shown as is,
 * its badge sits a paragraph (and a heading margin) above the heading, at body-text size. This
 * plugin marks such paragraphs (`section-anchor-line`) and, when a heading follows, the heading's
 * level (`data-before-heading`), so the stylesheet can collapse the paragraph and float its badge
 * into the heading's first line at the heading's size. The document and the saved Markdown don't
 * change. The cursor skips collapsed paragraphs, so text is never typed beside a hidden anchor.
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
