import type { Element, Root } from "hast";
import type { Nodes as MdastNodes, Parent as MdastParent, PhrasingContent, Root as MdastRoot, Text } from "mdast";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/**
 * The pipeline for chat answers (Step 010): model output is untrusted, so it gets a narrower
 * subset of Markdown than the preview. Raw HTML is never parsed into elements (no rehype-raw);
 * headings become bold paragraphs, and images, links, footnotes and HTML become text, so nothing
 * in an answer is clickable except citations: `[n]` markers whose number the server listed.
 */

/** The element a citation marker becomes; the client renders it as a link. */
export const CITATION_TAG = "specquer-citation";

/** Marks a citation marker in the syntax tree before it becomes an element. */
interface CitationNode {
  type: "citation";
  n: number;
}

const MARKER = /\[(\d+)\]/g;

/** The source text of a node, from its position. */
function sourceOf(node: MdastNodes, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? "" : source.slice(start, end);
}

function textNode(value: string): Text {
  return { type: "text", value };
}

/** The plain text of a node's descendants. */
function plainText(node: MdastNodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node.children as MdastNodes[]).map(plainText).join("");
  return "";
}

/** Parents whose children are blocks. */
const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);

/**
 * Restricts the syntax tree to the answer subset: headings become bold paragraphs; HTML, images,
 * footnotes and definitions become their source text; links become their text and URL.
 */
function remarkRestrict() {
  return (tree: MdastRoot, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (parent: MdastParent) => {
      const children: MdastNodes[] = [];
      for (const child of parent.children as MdastNodes[]) {
        switch (child.type) {
          case "heading":
            visit(child);
            children.push({ type: "paragraph", children: [{ type: "strong", children: child.children }] });
            break;
          case "html": {
            const text = textNode(child.position === undefined ? child.value : sourceOf(child, source));
            // Block HTML gets a paragraph, like any other block
            children.push(BLOCK_PARENTS.has(parent.type) ? { type: "paragraph", children: [text] } : text);
            break;
          }
          case "image":
          case "imageReference":
          case "footnoteReference":
            children.push(textNode(sourceOf(child, source)));
            break;
          case "definition":
          case "footnoteDefinition":
            children.push({ type: "paragraph", children: [textNode(sourceOf(child, source))] });
            break;
          case "link": {
            const text = plainText(child);
            children.push(textNode(text === child.url || `mailto:${text}` === child.url ? text : `${text} (${child.url})`));
            break;
          }
          case "linkReference":
            children.push(textNode(sourceOf(child, source) || plainText(child)));
            break;
          default:
            if ("children" in child) visit(child);
            children.push(child);
        }
      }
      parent.children = children as MdastParent["children"];
    };
    visit(tree);
  };
}

/** Turns `[n]` markers in text into citations when `n` is one of `numbers`; code is left alone. */
function remarkCitations(numbers: ReadonlySet<number>) {
  return (tree: MdastRoot) => {
    const visit = (parent: MdastParent) => {
      const children: Array<MdastNodes | CitationNode> = [];
      for (const child of parent.children as MdastNodes[]) {
        if (child.type === "text") {
          let last = 0;
          for (const match of child.value.matchAll(MARKER)) {
            const n = Number(match[1]);
            if (!numbers.has(n)) continue;
            if (match.index > last) children.push(textNode(child.value.slice(last, match.index)));
            children.push({ type: "citation", n });
            last = match.index + match[0].length;
          }
          if (last === 0) children.push(child);
          else if (last < child.value.length) children.push(textNode(child.value.slice(last)));
        } else {
          if ("children" in child) visit(child);
          children.push(child);
        }
      }
      parent.children = children as PhrasingContent[];
    };
    visit(tree);
  };
}

/** The elements and attributes an answer may hold, nothing else. */
export const answerSanitizeSchema: SanitizeSchema = {
  tagNames: [
    "p",
    "strong",
    "em",
    "del",
    "ul",
    "ol",
    "li",
    "code",
    "pre",
    "blockquote",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "br",
    CITATION_TAG,
  ],
  attributes: {
    ol: ["start"],
    th: ["align"],
    td: ["align"],
    code: [["className", /^language-./]],
    [CITATION_TAG]: ["dataN"],
  },
  protocols: {},
  required: {},
  clobber: [],
  clobberPrefix: "",
  strip: defaultSchema.strip ?? [],
  ancestors: {},
};

const base = unified().use(remarkParse).use(remarkGfm).freeze();

/**
 * Turns an answer's Markdown into a sanitized HTML syntax tree. `citations` are the numbers the
 * server listed; only their `[n]` markers become `specquer-citation` elements. Half-written
 * Markdown, as it arrives while streaming, is fine: unfinished syntax stays text.
 */
export function answerToHast(markdown: string, citations: Iterable<number>): Root {
  const numbers = new Set(citations);
  const processor = base()
    .use(remarkRestrict)
    .use(remarkCitations, numbers)
    .use(remarkRehype, {
      handlers: {
        citation: (_state: unknown, node: CitationNode): Element => ({
          type: "element",
          tagName: CITATION_TAG,
          properties: { dataN: String(node.n) },
          children: [{ type: "text", value: `[${node.n}]` }],
        }),
      } as never,
    })
    .use(rehypeSanitize, answerSanitizeSchema);
  return processor.runSync(processor.parse(markdown), markdown) as Root;
}
