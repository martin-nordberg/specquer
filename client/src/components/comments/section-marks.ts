import type { Element, Root, RootContent } from "hast";
import { analyzeBody } from "@specquer/shared/markdown";
import { sectionExtents, sectionParents } from "@specquer/shared/sections";

/**
 * Marks a rendered preview's blocks with the UID of the section they belong to
 * (`data-section-uid`): each top-level block with its innermost heading section, and each list
 * item that is a section with its own. The preview highlights a section by these marks (R6.3,
 * decision D4), without rendering the tree again.
 */
export function markSections(tree: Root, body: string): Root {
  const sections = analyzeBody(body).sections;
  if (sections.every((section) => section.uid === null)) return tree;
  // The parser skips a byte-order mark and counts offsets without it
  const bom = body.startsWith("﻿") ? 1 : 0;
  const extents = sectionExtents(
    sections.map((section) => ({ ...section, start: section.anchor?.from ?? section.insertAt })),
    body.length,
  );
  const blocks = sections.flatMap((section, index) => (section.kind === "item" || section.uid === null ? [] : [{ uid: section.uid, extent: extents[index]! }]));
  const items = new Map(sections.flatMap((section) => (section.kind === "item" && section.uid !== null && section.range !== undefined ? [[section.range.from, section.uid] as const] : [])));
  const blockAt = (offset: number) => {
    let found: string | undefined;
    // In document order, so the last section holding the offset is the innermost
    for (const block of blocks) if (block.extent.from <= offset && offset < block.extent.to) found = block.uid;
    return found;
  };
  const markItems = (node: RootContent): RootContent => {
    if (node.type !== "element") return node;
    const offset = node.position?.start.offset;
    const uid = node.tagName === "li" && offset !== undefined ? items.get(offset + bom) : undefined;
    const children = node.children.map(markItems) as Element["children"];
    return { ...node, ...(uid === undefined ? {} : { properties: { ...node.properties, dataSectionUid: uid } }), children };
  };
  return {
    ...tree,
    children: tree.children.map((child) => {
      if (child.type !== "element") return child;
      const offset = child.position?.start.offset;
      const uid = offset === undefined ? undefined : blockAt(offset + bom);
      const marked = items.size > 0 ? (markItems(child) as Element) : child;
      return uid === undefined ? marked : { ...marked, properties: { ...marked.properties, dataSectionUid: uid } };
    }),
  };
}

/**
 * Where the threads of sections the summary slider hides are counted (R5.6): for each hidden
 * section with threads, its nearest ancestor whose anchor is shown gets its count.
 */
export function hiddenCounts(body: string, shownUids: ReadonlySet<string>, counts: ReadonlyMap<string, number>): Map<string, number> {
  const result = new Map<string, number>();
  if (counts.size === 0) return result;
  const sections = analyzeBody(body).sections;
  const parents = sectionParents(sections);
  sections.forEach((section, index) => {
    const count = section.uid === null ? 0 : (counts.get(section.uid) ?? 0);
    if (count === 0 || shownUids.has(section.uid!)) return;
    for (let at = parents[index] ?? null; at !== null; at = parents[at] ?? null) {
      const uid = sections[at]!.uid;
      if (uid !== null && shownUids.has(uid)) {
        result.set(uid, (result.get(uid) ?? 0) + count);
        return;
      }
    }
  });
  return result;
}

/** The UIDs of the section anchors a rendered tree shows. */
export function shownAnchorUids(tree: Root): Set<string> {
  const uids = new Set<string>();
  const visit = (node: Root | RootContent) => {
    if (node.type === "element" && node.properties.dataSectionAnchor !== undefined && typeof node.properties.dataUid === "string") uids.add(node.properties.dataUid);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);
  return uids;
}
