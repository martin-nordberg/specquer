import type { Element, Root } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

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

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  // Front matter is edited separately and isn't part of the preview
  .use(remarkRehype, { allowDangerousHtml: true, handlers: { yaml: () => undefined } })
  .use(rehypeRaw)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypePrefixFragmentLinks)
  .freeze();

/** Turns Markdown text into a sanitized HTML syntax tree. */
export function markdownToHast(markdown: string): Root {
  return processor.runSync(processor.parse(markdown)) as Root;
}
