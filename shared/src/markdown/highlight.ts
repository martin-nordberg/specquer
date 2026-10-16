import type { Element, ElementContent, Root } from "hast";
import { common, createLowlight } from "lowlight";
import rehypeHighlight from "rehype-highlight";
import { type CodeHighlighter, codeFileToHast, createPreviewProcessor } from "./preview.ts";
import { hasLongLine } from "./languages.ts";

/**
 * Highlighting, with highlight.js's `common` grammars through `lowlight` (Step 014, R4). Exported
 * as its own subpath, `@specquer/shared/highlight`, which only the preview worker (and tests)
 * import, so the grammars stay out of the client's main bundle.
 */

const lowlight = createLowlight(common);

/** The text of an element, as written. */
function textOf(node: Element): string {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") text += child.value;
    else if (child.type === "element") text += textOf(child);
  }
  return text;
}

/**
 * Prepares code blocks for `rehype-highlight`: a language in any case finds its grammar (`TS`
 * is `ts`), and a block with a long line isn't highlighted (R4.3).
 */
function prepareCodeBlocks(tree: Root): void {
  const visit = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (child.tagName === "pre") {
        for (const code of child.children) {
          if (code.type !== "element" || code.tagName !== "code" || !Array.isArray(code.properties.className)) continue;
          const classes = code.properties.className.map((name) => (String(name).startsWith("language-") ? String(name).toLowerCase() : name));
          code.properties.className = hasLongLine(textOf(code)) ? [...classes, "no-highlight"] : classes;
        }
      }
      visit(child);
    }
  };
  visit(tree);
}

/** Highlights fenced code with a language; a language `common` lacks, or none, stays plain. */
export function rehypeCodeHighlight() {
  const highlight = rehypeHighlight({ detect: false });
  return (tree: Root, file: Parameters<typeof highlight>[1]) => {
    prepareCodeBlocks(tree);
    highlight(tree, file);
  };
}

/** Highlights a text file's code, if its language is one of `common`'s. */
export const highlightCode: CodeHighlighter = (language, text) =>
  lowlight.registered(language) ? (lowlight.highlight(language, text).children as ElementContent[]) : undefined;

const processor = createPreviewProcessor({ highlight: rehypeCodeHighlight });

/** Markdown to a sanitized HTML syntax tree, with its code blocks highlighted. */
export function highlightedMarkdownToHast(markdown: string): Root {
  return processor.runSync(processor.parse(markdown)) as Root;
}

/** A text file as a highlighted code block with line numbers. */
export function highlightedCodeFileToHast(text: string, language: string | undefined): Root {
  return codeFileToHast(text, language, highlightCode);
}
