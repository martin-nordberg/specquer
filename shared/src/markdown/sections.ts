import type { Heading, ListItem, Nodes, Paragraph, PhrasingContent, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { isSectionId } from "../sections/ids.ts";
import { isUid } from "../sections/uids.ts";

/**
 * Finding section anchors in a Markdown body and computing the edits that add or correct them.
 *
 * Sections are found from the Markdown syntax tree, not by matching lines, so anchors in code,
 * block quotes and nested lists are never touched. The body is the file without its front
 * matter, with `\n` line endings; all offsets are offsets into it.
 *
 * Recognized anchors (`<a id="…" data-uid="…"></a>`, empty, as two inline HTML nodes):
 * - Root: a paragraph holding only an anchor, as the body's first block, unless the heading on
 *   the very next line follows it, which makes it that heading's anchor. An anchor whose UID is
 *   a known document ID (`AnalyzeOptions.isDocumentUid`) is the root anchor regardless.
 * - Heading: a paragraph holding only an anchor, as the sibling directly before a top-level
 *   heading (blank lines allowed), or an anchor as the heading's first inline node (the setext
 *   form, and the form the WYSIWYG editor writes for some headings).
 * - List item: an anchor as the first inline node of the first paragraph of an item of a
 *   top-level list. A list is sectioned when at least one of its items has an anchor.
 *
 * An anchor whose `id` isn't in the section ID format (blank included) is a placeholder: the
 * section exists and gets an ID (and a new UID) when the anchors are next written.
 *
 * Anchors with a section ID anywhere else (in block quotes, nested lists, ordinary paragraphs)
 * are **stray**: they no longer mark a section, usually because text moved.
 */

export type SectionKind = "root" | "heading" | "item";

export interface Range {
  from: number;
  to: number;
}

export interface FoundAnchor extends Range {
  /** The `id` attribute's value, which may not be a section ID (a placeholder). */
  rawId: string;
  /** The whole `id="…"` attribute. */
  idAttribute: Range;
  /** The `data-uid` attribute's value, if any. */
  uid?: string;
  /** The whole `data-uid="…"` attribute. */
  uidAttribute?: Range;
  /** The offset of the open tag's closing `>`. */
  openTagEnd: number;
}

/** How a missing anchor is written for a section. */
export type AnchorForm = "root" | "atx" | "setext" | "item";

export interface FoundSection {
  kind: SectionKind;
  /** The section ID, or `null` when the section has no anchor yet or a placeholder. */
  id: string | null;
  /** The anchor's UID, or `null` when it has none, an invalid one, or the anchor is a placeholder. */
  uid: string | null;
  anchor?: FoundAnchor;
  /** The heading level (1 to 6) for heading sections. */
  depth?: number;
  /** The heading text, or the start of the item's text; "" for the root section. */
  title: string;
  /** Where a missing anchor goes. */
  insertAt: number;
  form: AnchorForm;
}

export interface BodyEdit {
  from: number;
  to: number;
  insert: string;
}

/** The anchors to write, by index into the found sections. */
export interface AnchorPlan {
  /**
   * New section IDs: needed for every section without an ID, and given for a section with an ID
   * to renumber it or put back its recorded ID.
   */
  ids: ReadonlyMap<number, string>;
  /**
   * New UIDs: needed for every section without an anchor, and given for an anchor whose UID is
   * missing or must change. The root section's UID is the document ID.
   */
  uids: ReadonlyMap<number, string>;
}

/** An anchor with a section ID that isn't in a section's place. */
export interface StrayAnchor {
  id: string;
  from: number;
  to: number;
  /** The line it is on, from 1, counted in the body. */
  line: number;
}

export interface AnalyzeOptions {
  /** Whether a UID is a known document ID, which marks the root anchor whatever follows it. */
  isDocumentUid?: (uid: string) => boolean;
}

export interface BodyAnalysis {
  sections: FoundSection[];
  strays: StrayAnchor[];
}

const parser = unified().use(remarkParse).use(remarkGfm).freeze();

/** The words of a list item's text used as its title. */
const ITEM_TITLE_WORDS = 8;

const OPEN_TAG = /^<a(\s[^<>]*)?>$/i;
const CLOSE_TAG = /^<\/a\s*>$/i;
const ATTRIBUTE = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function start(node: Nodes): number {
  return node.position?.start.offset ?? 0;
}

function end(node: Nodes): number {
  return node.position?.end.offset ?? 0;
}

/** An anchor made of two inline HTML nodes starting at `children[index]`, or `undefined`. */
function anchorAt(children: PhrasingContent[], index: number): FoundAnchor | undefined {
  const open = children[index];
  const close = children[index + 1];
  if (open?.type !== "html" || close?.type !== "html" || !CLOSE_TAG.test(close.value)) return undefined;
  const match = OPEN_TAG.exec(open.value);
  if (match === null) return undefined;
  const from = start(open);
  const attributes = match[1] ?? "";
  const attributesStart = from + 2;
  let anchor: FoundAnchor | undefined;
  let uid: { value: string; range: Range } | undefined;
  for (const attribute of attributes.matchAll(ATTRIBUTE)) {
    const name = attribute[1]!.toLowerCase();
    const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
    const range = { from: attributesStart + attribute.index, to: attributesStart + attribute.index + attribute[0].length };
    if (name === "id" && anchor === undefined) {
      anchor = { from, to: end(close), rawId: value, idAttribute: range, openTagEnd: end(open) - 1 };
    } else if (name === "data-uid" && uid === undefined) uid = { value, range };
  }
  if (anchor !== undefined && uid !== undefined) {
    anchor.uid = uid.value;
    anchor.uidAttribute = uid.range;
  }
  return anchor;
}

/**
 * The section ID of an anchor's open tag, as raw HTML (`<a id="REQ-00001" …>`), or `undefined`
 * when the tag isn't an anchor or its ID isn't a section ID.
 */
export function anchorTagSectionId(html: string): string | undefined {
  const match = OPEN_TAG.exec(html.trim());
  if (match === null) return undefined;
  for (const attribute of (match[1] ?? "").matchAll(ATTRIBUTE)) {
    if (attribute[1]!.toLowerCase() !== "id") continue;
    const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
    return isSectionId(value) ? value : undefined;
  }
  return undefined;
}

/** Whether raw HTML is an anchor's closing tag. */
export function isAnchorCloseTag(html: string): boolean {
  return CLOSE_TAG.test(html.trim());
}

/** The anchor of a paragraph that holds nothing else (whitespace aside). */
function soleAnchor(node: RootContent | undefined): FoundAnchor | undefined {
  if (node?.type !== "paragraph") return undefined;
  const rest = node.children.slice(2);
  if (rest.some((child) => child.type !== "text" || child.value.trim() !== "")) return undefined;
  return anchorAt(node.children, 0);
}

function plainText(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "html") return "";
  if ("children" in node) return node.children.map((child) => plainText(child as Nodes)).join("");
  return "";
}

function isAtx(body: string, heading: Heading): boolean {
  return body[start(heading)] === "#";
}

/** The start of the line holding `offset`; the first line starts after a byte-order mark. */
function lineStart(body: string, offset: number): number {
  const start = body.lastIndexOf("\n", offset - 1) + 1;
  return start === 0 ? bodyStart(body) : start;
}

/** Where the content starts: after a byte-order mark, which a body without front matter keeps. */
function bodyStart(body: string): number {
  return body.startsWith("\uFEFF") ? 1 : 0;
}

function sectionId(anchor: FoundAnchor | undefined): string | null {
  return anchor !== undefined && isSectionId(anchor.rawId) ? anchor.rawId : null;
}

function sectionUid(anchor: FoundAnchor | undefined): string | null {
  return sectionId(anchor) !== null && anchor!.uid !== undefined && isUid(anchor!.uid) ? anchor!.uid : null;
}

function itemSection(item: ListItem): FoundSection | undefined {
  const paragraph = item.children[0];
  if (paragraph?.type !== "paragraph" || paragraph.children.length === 0) return undefined;
  const anchor = anchorAt(paragraph.children, 0);
  const words = plainText(paragraph as Paragraph).trim().split(/\s+/).filter((word) => word !== "");
  return {
    kind: "item",
    id: sectionId(anchor),
    uid: sectionUid(anchor),
    anchor,
    title: words.slice(0, ITEM_TITLE_WORDS).join(" ") + (words.length > ITEM_TITLE_WORDS ? " …" : ""),
    insertAt: start(paragraph.children[0]!),
    form: "item",
  };
}

function shift<T extends Range>(range: T, by: number): T {
  return { ...range, from: range.from + by, to: range.to + by };
}

/** Parses a body (with `\n` line endings) and finds its sections, the root section first. */
export function findSections(body: string, options: AnalyzeOptions = {}): FoundSection[] {
  return analyzeBody(body, options).sections;
}

/** Parses a body (with `\n` line endings): its sections, the root section first, and its stray anchors. */
export function analyzeBody(body: string, options: AnalyzeOptions = {}): BodyAnalysis {
  // The parser skips a byte-order mark and counts offsets without it
  const bom = bodyStart(body);
  const found = analyzeIn(bom === 0 ? body : body.slice(bom), options);
  const lineOf = (offset: number) => body.slice(0, offset).split("\n").length;
  const strays = found.strays.map((stray) => ({ ...shift(stray, bom), line: lineOf(stray.from + bom) }));
  if (bom === 0) return { sections: found.sections, strays };
  const sections = found.sections.map((section) => {
    const anchor = section.anchor;
    return {
      ...section,
      insertAt: section.insertAt + bom,
      anchor:
        anchor === undefined
          ? undefined
          : {
              ...shift(anchor, bom),
              idAttribute: shift(anchor.idAttribute, bom),
              uidAttribute: anchor.uidAttribute && shift(anchor.uidAttribute, bom),
              openTagEnd: anchor.openTagEnd + bom,
            },
    };
  });
  return { sections, strays };
}

/** Every anchor in the tree, outside code. */
function allAnchors(node: Nodes, found: FoundAnchor[]): FoundAnchor[] {
  if (!("children" in node)) return found;
  const children = node.children as Nodes[];
  children.forEach((child, index) => {
    if (child.type !== "html") allAnchors(child, found);
    else {
      const anchor = anchorAt(children as PhrasingContent[], index);
      if (anchor !== undefined) found.push(anchor);
    }
  });
  return found;
}

function analyzeIn(body: string, options: AnalyzeOptions): { sections: FoundSection[]; strays: Omit<StrayAnchor, "line">[] } {
  const tree = parser.parse(body) as Root;
  const sections = sectionsOf(body, tree, options);
  const used = new Set(sections.flatMap((section) => (section.anchor === undefined ? [] : [section.anchor.from])));
  const strays = allAnchors(tree, [])
    .filter((anchor) => isSectionId(anchor.rawId) && !used.has(anchor.from))
    .map((anchor) => ({ id: anchor.rawId, from: anchor.from, to: anchor.to }));
  return { sections, strays };
}

function sectionsOf(body: string, tree: Root, options: AnalyzeOptions): FoundSection[] {
  const blocks = tree.children;
  const sections: FoundSection[] = [];

  // The root anchor
  let rootAnchor: FoundAnchor | undefined;
  const first = blocks[0];
  const firstAnchor = soleAnchor(first);
  if (first !== undefined && firstAnchor !== undefined) {
    const next = blocks[1];
    const headingOnNextLine = next?.type === "heading" && next.position!.start.line === first.position!.end.line + 1;
    const documentUid = firstAnchor.uid !== undefined && options.isDocumentUid?.(firstAnchor.uid) === true;
    if (documentUid || !headingOnNextLine) rootAnchor = firstAnchor;
  }
  sections.push({
    kind: "root",
    id: sectionId(rootAnchor),
    uid: sectionUid(rootAnchor),
    anchor: rootAnchor,
    title: "",
    insertAt: 0,
    form: "root",
  });

  blocks.forEach((block, index) => {
    if (block.type === "heading") {
      const previous = index > 0 ? blocks[index - 1] : undefined;
      const before = previous === first && rootAnchor !== undefined ? undefined : soleAnchor(previous);
      const inline = anchorAt(block.children, 0);
      const anchor = before ?? inline;
      const atx = isAtx(body, block);
      sections.push({
        kind: "heading",
        id: sectionId(anchor),
        uid: sectionUid(anchor),
        anchor,
        depth: block.depth,
        title: plainText(block).trim(),
        insertAt: atx ? lineStart(body, start(block)) : start(block),
        form: atx ? "atx" : "setext",
      });
    } else if (block.type === "list") {
      const items = block.children.map(itemSection);
      if (!items.some((item) => item?.anchor !== undefined)) return;
      for (const item of items) if (item !== undefined) sections.push(item);
    }
  });
  return sections;
}

/** Whether a found section needs an ID (it has no anchor, or a placeholder). */
export function needsId(section: FoundSection): boolean {
  return section.id === null;
}

/**
 * Whether a body holds Git merge conflict markers: a `<<<<<<<` line and a `>>>>>>>` line. A
 * `=======` line alone is a setext heading's underline, so it doesn't count.
 */
export function hasConflictMarkers(body: string): boolean {
  return /^<{7}(?: |$)/m.test(body) && /^>{7}(?: |$)/m.test(body);
}

function anchorTag(id: string, uid: string): string {
  return `<a id="${id}" data-uid="${uid}"></a>`;
}

/** The anchor for a new file's body; the root section's UID is the document ID. */
export function rootAnchorText(id: string, uid: string): string {
  return `${anchorTag(id, uid)}\n\n`;
}

/**
 * The edits that bring a body's anchors in line with a plan: missing anchors inserted with their
 * IDs and UIDs, placeholders and renumbered sections given their IDs, UIDs added or replaced.
 * Edits are sorted by position and don't overlap.
 */
export function anchorEdits(body: string, sections: readonly FoundSection[], plan: AnchorPlan): BodyEdit[] {
  const edits: BodyEdit[] = [];
  sections.forEach((section, index) => {
    const newId = plan.ids.get(index);
    const newUid = plan.uids.get(index);
    const anchor = section.anchor;
    if (anchor === undefined) {
      if (newId === undefined || newUid === undefined) throw new Error(`No ID or UID planned for section ${index}`);
      edits.push({ from: section.insertAt, to: section.insertAt, insert: insertion(body, section, newId, newUid) });
      return;
    }
    if (newId === undefined && section.id === null) throw new Error(`No ID planned for placeholder ${index}`);
    if (newId !== undefined && newId !== anchor.rawId) edits.push({ ...anchor.idAttribute, insert: `id="${newId}"` });
    if (newUid === undefined) {
      if (section.uid === null) throw new Error(`No UID planned for section ${index}`);
    } else if (anchor.uidAttribute === undefined) {
      // Directly after `id`, as Specquer writes it
      edits.push({ from: anchor.idAttribute.to, to: anchor.idAttribute.to, insert: ` data-uid="${newUid}"` });
    } else if (anchor.uid !== newUid) edits.push({ ...anchor.uidAttribute, insert: `data-uid="${newUid}"` });
  });
  // Stable: at equal positions the root anchor stays before a heading's
  return edits.sort((a, b) => a.from - b.from);
}

function insertion(body: string, section: FoundSection, id: string, uid: string): string {
  switch (section.form) {
    case "root":
      return rootAnchorText(id, uid);
    case "atx": {
      // The anchor needs a blank line above it, or it joins the paragraph before
      const at = section.insertAt;
      const previousLine = at <= bodyStart(body) ? "" : body.slice(lineStart(body, at - 1), at - 1);
      return `${previousLine.trim() === "" ? "" : "\n"}${anchorTag(id, uid)}\n`;
    }
    case "setext":
    case "item":
      return `${anchorTag(id, uid)} `;
  }
}

/** Applies sorted, non-overlapping edits to a text. */
export function applyEdits(text: string, edits: readonly BodyEdit[]): string {
  let result = "";
  let position = 0;
  for (const edit of edits) {
    result += text.slice(position, edit.from) + edit.insert;
    position = edit.to;
  }
  return result + text.slice(position);
}
