import type { Element, Root, RootContent } from "hast";
import { type Outline, type SummarizedSection, outlineHeadings } from "./outline.ts";

/**
 * Puts summaries into a rendered preview (decision D1): the whole body is rendered once, then the
 * tree's top-level children are filtered by their source offsets. A summarized section keeps its
 * heading (except the whole document's summary) and the rest of its range is replaced by one
 * `specquer-summary` element. Rendering once keeps reference links and footnotes working.
 */

/** The element that stands for a summary; its `dataPath` is the section's outline path. */
export const SUMMARY_TAG = "specquer-summary";

/** Set on top-level headings (`data-outline-path`), so sections without anchors can be scrolled to. */
export const OUTLINE_PATH_PROPERTY = "dataOutlinePath";

const isBlank = (node: RootContent) => node.type === "text" && node.value.trim() === "";

/**
 * Returns a new tree with `summarized` replaced by summary elements, and every top-level heading
 * marked with its outline path. `body` is the text the tree was rendered from.
 */
export function summarizeTree(tree: Root, body: string, outline: Outline, summarized: readonly SummarizedSection[]): Root {
  // The parser skips a byte-order mark and counts offsets without it
  const bom = body.startsWith("\uFEFF") ? 1 : 0;
  const headings = outlineHeadings(outline);
  const children: RootContent[] = [];
  const placed = new Set<SummarizedSection>();
  let inside: SummarizedSection | undefined;

  for (const child of tree.children) {
    const offset = child.position?.start.offset;
    if (offset === undefined) {
      // Generated content (footnotes) stays unless the whole document is summarized; blank text
      // goes with the section it is in
      if (inside === undefined || (!inside.document && !isBlank(child))) children.push(child);
      continue;
    }
    const at = offset + bom;
    inside = summarized.find((section) => at >= section.range.from && at < section.range.to);
    let node = child;
    const path = node.type === "element" && /^h[1-6]$/.test(node.tagName) ? headings.find(({ heading }) => at >= heading.from && at < heading.to)?.path : undefined;
    if (path !== undefined && node.type === "element") node = { ...node, properties: { ...node.properties, [OUTLINE_PATH_PROPERTY]: path } };
    if (inside === undefined) {
      children.push(node);
    } else if (inside.heading !== null && at >= inside.heading.from && at < inside.heading.to) {
      children.push(node);
      placed.add(inside);
      children.push(summaryElement(inside.path));
    } else if (!placed.has(inside)) {
      placed.add(inside);
      children.push(summaryElement(inside.path));
    }
  }
  return { ...tree, children };
}

function summaryElement(path: string): Element {
  return { type: "element", tagName: SUMMARY_TAG, properties: { dataPath: path }, children: [] };
}
