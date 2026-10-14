import type { Root } from "hast";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { answerSanitizeSchema, remarkRestrict } from "./answer.ts";

/**
 * The pipeline for comments (Step 012, R2.10): the chat answers' subset of Markdown, without
 * citations. Raw HTML is never parsed into elements, and no link or image is rendered as one: a
 * link shows as its text and URL, an image as its alt text and URL, both plain text that can be
 * copied, whether inline, by reference or a bare URL.
 */

const { [`specquer-citation`]: _, ...attributes } = answerSanitizeSchema.attributes ?? {};

export const commentSanitizeSchema = {
  ...answerSanitizeSchema,
  tagNames: (answerSanitizeSchema.tagNames ?? []).filter((tag) => tag !== "specquer-citation"),
  attributes,
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRestrict, { resolveReferences: true })
  .use(remarkRehype)
  .use(rehypeSanitize, commentSanitizeSchema)
  .freeze();

/** Turns a comment's Markdown into a sanitized HTML syntax tree. */
export function commentToHast(markdown: string): Root {
  return processor.runSync(processor.parse(markdown), markdown) as Root;
}
