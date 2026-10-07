import type { Element, ElementContent, Root, RootContent } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { isSectionId } from "../sections/ids.ts";

/**
 * The preview pipeline: Markdown text in, a sanitized HTML syntax tree (hast) out.
 *
 * It uses no DOM or Bun APIs, so it runs unchanged in the browser, in a Web Worker and on the
 * server. Raw HTML in the Markdown is parsed (rehype-raw) and then sanitized with a strict list
 * of allowed tags and attributes (decision D15).
 */

/** The prefix the sanitizer adds to `id` and `name` attributes against DOM clobbering. */
export const CLOBBER_PREFIX = "user-content-";

const defaultAttributes = defaultSchema.attributes ?? {};

/**
 * GitHub's schema, plus `data-*` attributes on links and spans, used by traceability anchors
 * such as `<a name="r7k2" data-status="draft"></a>`.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: CLOBBER_PREFIX,
  attributes: {
    ...defaultAttributes,
    a: [...(defaultAttributes.a ?? []), "data*"],
    span: [...(defaultAttributes.span ?? []), "data*"],
  },
};

/**
 * Rewrites in-page links (`#id`) to the prefixed ids the sanitizer produces, so links to
 * anchors keep working.
 */
function rehypePrefixFragmentLinks() {
  return (tree: Root) => {
    const visit = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        const href = child.properties.href;
        if (child.tagName === "a" && typeof href === "string" && href.startsWith("#") && href.length > 1) {
          const id = decodeURIComponent(href.slice(1));
          if (!id.startsWith(CLOBBER_PREFIX)) child.properties.href = `#${CLOBBER_PREFIX}${id}`;
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

/** Set on section anchors by the preview (`data-section-anchor`), with the section's kind. */
export const SECTION_ANCHOR_PROPERTY = "dataSectionAnchor";

/** The section ID of an empty `<a>` carrying one in its (prefixed) `id`, or `undefined`. */
export function sectionAnchorId(node: RootContent | undefined): string | undefined {
  if (node?.type !== "element" || node.tagName !== "a" || node.children.length > 0) return undefined;
  const id = node.properties.id;
  if (typeof id !== "string" || !id.startsWith(CLOBBER_PREFIX)) return undefined;
  const sectionId = id.slice(CLOBBER_PREFIX.length);
  return isSectionId(sectionId) ? sectionId : undefined;
}

const isBlank = (node: RootContent) => node.type === "text" && node.value.trim() === "";
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** The first child that isn't blank text or (in a task item) the check box. */
function firstContent(children: ElementContent[]): ElementContent | undefined {
  return children.find((child) => !isBlank(child) && !(child.type === "element" && child.tagName === "input"));
}

/**
 * Marks the section anchors at the top level of the document (the root anchor, headings' and
 * list items' anchors) so the preview can show badges, and moves a heading's anchor, written on
 * the line before it, into the heading, so the badge sits at the heading's start.
 */
function rehypeSectionAnchors() {
  return (tree: Root) => {
    const mark = (node: RootContent | undefined, kind: string) => {
      if (node?.type === "element" && sectionAnchorId(node) !== undefined) node.properties[SECTION_ANCHOR_PROPERTY] = kind;
    };
    const blocks = tree.children;
    const soleAnchor = (node: Element): Element | undefined => {
      if (node.tagName !== "p") return undefined;
      const content = node.children.filter((child) => !isBlank(child));
      const only = content.length === 1 ? content[0] : undefined;
      return sectionAnchorId(only) !== undefined ? (only as Element) : undefined;
    };
    let firstBlock = true;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      if (isBlank(block)) continue;
      if (block.type !== "element") {
        firstBlock = false;
        continue;
      }
      const anchor = soleAnchor(block);
      if (anchor !== undefined) {
        let j = i + 1;
        while (j < blocks.length && isBlank(blocks[j]!)) j++;
        const next = blocks[j];
        const nextIsHeading = next?.type === "element" && HEADINGS.has(next.tagName);
        // The first block's anchor is the root's, unless (written before document IDs) it
        // belongs to the heading directly after it
        if (firstBlock && (anchor.properties.dataDocumentId !== undefined || !nextIsHeading)) {
          mark(anchor, "root");
        } else if (nextIsHeading && sectionAnchorId(firstContent((next as Element).children)) === undefined) {
          mark(anchor, "heading");
          (next as Element).children.unshift(anchor, { type: "text", value: " " });
          blocks.splice(i, j - i);
          i--;
        }
        firstBlock = false;
        continue;
      }
      firstBlock = false;
      if (HEADINGS.has(block.tagName)) mark(firstContent(block.children), "heading");
      else if (block.tagName === "ul" || block.tagName === "ol") {
        for (const item of block.children) {
          if (item.type !== "element" || item.tagName !== "li") continue;
          let first = firstContent(item.children);
          if (first?.type === "element" && first.tagName === "p") first = firstContent(first.children);
          mark(first, "item");
        }
      }
    }
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  // Front matter is edited separately and isn't part of the preview
  .use(remarkRehype, { allowDangerousHtml: true, handlers: { yaml: () => undefined } })
  .use(rehypeRaw)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypePrefixFragmentLinks)
  .use(rehypeSectionAnchors)
  .freeze();

/** Turns Markdown text into a sanitized HTML syntax tree. */
export function markdownToHast(markdown: string): Root {
  return processor.runSync(processor.parse(markdown)) as Root;
}
