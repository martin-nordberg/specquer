import { sectionParents } from "../sections/tree.ts";
import { type FoundSection, type Range, analyzeBody } from "./sections.ts";

/**
 * The heading outline of a Markdown body, for summaries: each top-level heading's section with
 * the source range it covers. Built from the same syntax tree as `analyzeBody`, so headings in
 * block quotes and lists don't count. Offsets are offsets into the body (`\n` line endings).
 */

export interface OutlineSection {
  /** The heading level, 1 to 6. */
  depth: number;
  title: string;
  /** The heading, from its section anchor on the line before it, if any, to the heading's end. */
  heading: Range;
  /** The whole section: from `heading.from` to the next heading of the same or a higher level. */
  range: Range;
  /** The text under the heading before its first subsection. */
  lead: Range;
  children: OutlineSection[];
}

export interface Outline {
  /** The text before the first heading. */
  preamble: Range;
  sections: OutlineSection[];
  /** The heading levels used, ascending. */
  levels: number[];
}

/** Builds the outline of a body. */
export function buildOutline(body: string): Outline {
  const headings = analyzeBody(body).sections.filter((section) => section.kind === "heading");
  const end = body.length;
  const flat = headings.map((section) => {
    const anchorFrom = section.anchor?.from ?? section.insertAt;
    const from = Math.min(anchorFrom, section.insertAt);
    return { depth: section.depth ?? 1, title: section.title, from, headingEnd: headingEnd(body, section.insertAt) };
  });

  const sections: OutlineSection[] = [];
  const stack: OutlineSection[] = [];
  flat.forEach((heading, index) => {
    // The section runs to the next heading of the same or a higher level
    let to = end;
    for (let next = index + 1; next < flat.length; next++) {
      if (flat[next]!.depth <= heading.depth) {
        to = flat[next]!.from;
        break;
      }
    }
    const firstChild = flat[index + 1] !== undefined && flat[index + 1]!.depth > heading.depth ? flat[index + 1]!.from : to;
    const section: OutlineSection = {
      depth: heading.depth,
      title: heading.title,
      heading: { from: heading.from, to: heading.headingEnd },
      range: { from: heading.from, to },
      lead: { from: Math.min(heading.headingEnd, firstChild), to: firstChild },
      children: [],
    };
    while (stack.length > 0 && stack.at(-1)!.depth >= section.depth) stack.pop();
    (stack.at(-1)?.children ?? sections).push(section);
    stack.push(section);
  });

  return {
    preamble: { from: 0, to: flat[0]?.from ?? end },
    sections,
    levels: [...new Set(flat.map((heading) => heading.depth))].sort((a, b) => a - b),
  };
}

/**
 * Where a heading ends: the end of its line for an ATX heading, the end of its underline for a
 * setext one. `insertAt` is the heading's line start (ATX) or its first character (setext).
 */
function headingEnd(body: string, insertAt: number): number {
  const lineEnd = (from: number) => {
    const at = body.indexOf("\n", from);
    return at === -1 ? body.length : at;
  };
  const first = lineEnd(insertAt);
  if (/^ {0,3}#/.test(body.slice(insertAt, first))) return first;
  // Setext: the heading's text may span lines; it ends with the `===` or `---` underline
  let at = first;
  while (at < body.length) {
    const next = lineEnd(at + 1);
    if (/^ {0,3}(=+|-+)[ \t]*$/.test(body.slice(at + 1, next))) return next;
    at = next;
  }
  return first;
}

/** The number of slider stops: one per heading level plus the full text and the whole document; none without headings. */
export function summaryStopCount(outline: Outline): number {
  return outline.levels.length === 0 ? 0 : outline.levels.length + 2;
}

/** A section a stop replaces with a summary. */
export interface SummarizedSection {
  /** Section indexes from the top (`1.0.2`), or "" for the whole document. */
  path: string;
  /** The whole document (stop 0), whose summary replaces its headings too. */
  document: boolean;
  /** The section's heading, kept above its summary; `null` for the whole document. */
  heading: Range | null;
  range: Range;
  /** The titles of the headings above the section, outermost first. */
  headings: string[];
}

/**
 * The sections a stop summarizes. Stop `levels.length + 1` is the full text; stop `k` (1 to
 * `levels.length`) summarizes each section at level `levels[k - 1]` or deeper that isn't inside
 * one already summarized; stop 0 summarizes the whole document.
 */
export function summarizedAt(outline: Outline, stop: number, bodyLength: number): SummarizedSection[] {
  const count = summaryStopCount(outline);
  if (count === 0 || stop >= count - 1) return [];
  if (stop <= 0) return [{ path: "", document: true, heading: null, range: { from: 0, to: bodyLength }, headings: [] }];
  const depth = outline.levels[stop - 1]!;
  const found: SummarizedSection[] = [];
  const visit = (sections: OutlineSection[], path: number[], headings: string[]) => {
    sections.forEach((section, index) => {
      const here = [...path, index];
      if (section.depth >= depth) {
        found.push({ path: here.join("."), document: false, heading: section.heading, range: section.range, headings });
      } else visit(section.children, here, [...headings, section.title]);
    });
  };
  visit(outline.sections, [], []);
  return found;
}

/** Every section's heading range with its outline path, in document order. */
export function outlineHeadings(outline: Outline): Array<{ heading: Range; path: string }> {
  const found: Array<{ heading: Range; path: string }> = [];
  const visit = (sections: OutlineSection[], path: number[]) =>
    sections.forEach((section, index) => {
      found.push({ heading: section.heading, path: [...path, index].join(".") });
      visit(section.children, [...path, index]);
    });
  visit(outline.sections, []);
  return found;
}

/** The section at an outline path, or `undefined`. */
export function sectionAtPath(outline: Outline, path: string): OutlineSection | undefined {
  if (path === "") return undefined;
  let sections = outline.sections;
  let found: OutlineSection | undefined;
  for (const part of path.split(".")) {
    found = sections[Number(part)];
    if (found === undefined) return undefined;
    sections = found.children;
  }
  return found;
}

/** The stop's accessible name. */
export function summaryStopName(outline: Outline, stop: number): string {
  const count = summaryStopCount(outline);
  if (stop >= count - 1) return "Full text";
  if (stop <= 0) return "Summarize document";
  return `Summarize level ${outline.levels[stop - 1]} sections`;
}

/**
 * An item of the Outline pane (Step 016): a section of a sectioned document, or a heading of one
 * that isn't sectioned, with what is below it.
 */
export interface OutlineItem {
  /**
   * What the item is remembered by (collapsed, highlighted): the section's UID; else, for a
   * heading, `path:` and its outline path; else `at:` and its offset, until the next edit.
   */
  key: string;
  kind: "heading" | "item";
  /** A heading's text; a list item's ID and first words. */
  text: string;
  sectionId: string | null;
  uid: string | null;
  /** A heading's outline path (`0.2.1`), as the summaries use; `null` for list items. */
  outlinePath: string | null;
  /** Where the section starts in the body. */
  from: number;
  children: OutlineItem[];
}

/**
 * The Outline's tree of a body (Step 016, R2, R3): in a sectioned document its sections, list
 * items included, nested as `sectionParents` nests them; in one that isn't sectioned, its
 * headings. The root section isn't an item: its sections are the top level. Built on the
 * heading outline, so each heading has the outline path the summary slider uses (plan D1).
 */
export function outlineTree(body: string, options: { sectioned: boolean }, analysis?: { sections: readonly FoundSection[]; outline: Outline }): OutlineItem[] {
  const sections = analysis?.sections ?? analyzeBody(body).sections;
  const outline = analysis?.outline ?? buildOutline(body);
  const paths = outlineHeadings(outline).map((heading) => heading.path);
  const parents = sectionParents(sections);
  const items = new Map<number, OutlineItem>();
  const top: OutlineItem[] = [];
  let heading = 0;
  sections.forEach((section, index) => {
    if (section.kind === "root") return;
    const outlinePath = section.kind === "heading" ? (paths[heading++] ?? null) : null;
    if (section.kind === "item" && !options.sectioned) return;
    const sectioned = options.sectioned;
    const id = sectioned ? section.id : null;
    const uid = sectioned ? section.uid : null;
    const from = Math.min(section.anchor?.from ?? section.insertAt, section.range?.from ?? section.insertAt, section.insertAt);
    const text = section.kind === "item" ? [id, section.title].filter((part) => part !== null && part !== "").join(" ") : section.title;
    const key = uid ?? (outlinePath !== null ? `path:${outlinePath}` : `at:${from}`);
    const item: OutlineItem = { key, kind: section.kind, text, sectionId: id, uid, outlinePath, from, children: [] };
    items.set(index, item);
    // The nearest enclosing section shown in the tree, or the top level
    let parent = parents[index] ?? null;
    while (parent !== null && !items.has(parent)) parent = parents[parent] ?? null;
    (parent === null ? top : items.get(parent)!.children).push(item);
  });
  return top;
}

/** What the summary slider leaves of the outline (Step 016, R7). */
export interface VisibleOutline {
  items: OutlineItem[];
  /** The keys of the items whose sections a summary replaces; nothing below them is shown. */
  summarized: ReadonlySet<string>;
  /** The whole document is summarized: no item is shown. */
  whole: boolean;
}

/**
 * The items a slider stop leaves visible: a summarized section stays, marked, without what is
 * below it, as its summary stays in the preview (R7.1, R7.2); the whole document summarized
 * leaves none (R7.3).
 */
export function visibleAt(items: readonly OutlineItem[], summarized: readonly SummarizedSection[]): VisibleOutline {
  if (summarized.some((section) => section.document)) return { items: [], summarized: new Set(), whole: true };
  const paths = new Set(summarized.map((section) => section.path));
  const keys = new Set<string>();
  const visit = (list: readonly OutlineItem[]): OutlineItem[] =>
    list.map((item) => {
      if (item.outlinePath !== null && paths.has(item.outlinePath)) {
        keys.add(item.key);
        return { ...item, children: [] };
      }
      return item.children.length === 0 ? item : { ...item, children: visit(item.children) };
    });
  return { items: paths.size === 0 ? [...items] : visit(items), summarized: keys, whole: false };
}

/** Where a view's top is: the section there, by UID, and the heading, by outline path. */
export interface TopPosition {
  uid: string | null;
  outlinePath: string | null;
}

/**
 * The keys from the top level down to the item at a position, found by UID, else by outline
 * path; `[]` when none matches. The caller highlights the deepest of them it shows, so a
 * position inside a summary or a collapsed item lands on that item (R4.5, R7.6).
 */
export function itemPathAt(items: readonly OutlineItem[], position: TopPosition): string[] {
  const search = (list: readonly OutlineItem[], match: (item: OutlineItem) => boolean): string[] => {
    for (const item of list) {
      if (match(item)) return [item.key];
      const below = search(item.children, match);
      if (below.length > 0) return [item.key, ...below];
    }
    return [];
  };
  if (position.uid !== null) {
    const found = search(items, (item) => item.uid === position.uid);
    if (found.length > 0) return found;
  }
  return position.outlinePath === null ? [] : search(items, (item) => item.outlinePath === position.outlinePath);
}

/** Every key in a tree, for pruning remembered state. */
export function outlineKeys(items: readonly OutlineItem[]): string[] {
  const keys: string[] = [];
  const visit = (list: readonly OutlineItem[]) => {
    for (const item of list) {
      keys.push(item.key);
      visit(item.children);
    }
  };
  visit(items);
  return keys;
}
