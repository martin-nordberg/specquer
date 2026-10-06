import { parseDocument } from "yaml";

/**
 * Splitting a Markdown file into its YAML front matter and its body, and joining them again.
 *
 * Both work on text, so a split followed by a join gives back the original text byte for byte.
 * The layout records the details (line ending, byte-order mark, the closing delimiter line)
 * needed for that.
 */

export interface FrontmatterLayout {
  /** The line ending after the delimiters. */
  eol: "\n" | "\r\n";
  /** A byte-order mark before the opening delimiter. */
  bom: boolean;
  /** The closing delimiter line as written, such as `---` (trailing spaces are kept). */
  closingLine: string;
  /** Whether the closing delimiter is followed by a line ending (false only at the end of the file). */
  closingEol: boolean;
  /** Whether the block has no lines at all between the delimiters (`---` directly followed by `---`). */
  emptyBlock: boolean;
}

export interface SplitFile {
  /** The front matter text without its delimiters, or `null` when the file has none. */
  frontmatter: string | null;
  body: string;
  layout: FrontmatterLayout;
}

const BOM = "﻿";

/** Detects the line ending used in a text: `\r\n` if its first line ending is one, `\n` otherwise. */
export function detectEol(text: string): "\n" | "\r\n" {
  const i = text.indexOf("\n");
  return i > 0 && text[i - 1] === "\r" ? "\r\n" : "\n";
}

/** Converts all line endings to `\n`. */
export function toLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Converts `\n` line endings to `eol`. The text must use `\n` only. */
export function fromLf(text: string, eol: "\n" | "\r\n"): string {
  return eol === "\n" ? text : text.replace(/\n/g, "\r\n");
}

export function defaultLayout(eol: "\n" | "\r\n" = "\n"): FrontmatterLayout {
  return { eol, bom: false, closingLine: "---", closingEol: true, emptyBlock: false };
}

const CLOSING_LINE = /^---[ \t]*$/;

export function splitFrontmatter(text: string): SplitFile {
  const bom = text.startsWith(BOM);
  const content = bom ? text.slice(1) : text;
  const eol = detectEol(content);
  const noFrontmatter: SplitFile = { frontmatter: null, body: text, layout: { ...defaultLayout(eol), bom: false } };

  const opening = `---${eol}`;
  if (!content.startsWith(opening)) return noFrontmatter;

  // Find the closing delimiter line
  let lineStart = opening.length;
  while (lineStart <= content.length) {
    let lineEnd = content.indexOf("\n", lineStart);
    const atEnd = lineEnd < 0;
    if (atEnd) lineEnd = content.length;
    let line = content.slice(lineStart, lineEnd);
    if (!atEnd && line.endsWith("\r")) line = line.slice(0, -1);
    if (CLOSING_LINE.test(line)) {
      const between = content.slice(opening.length, lineStart);
      const emptyBlock = between === "";
      // A file mixing line endings could end the last front matter line differently; only
      // accept the block when the layout can reproduce it exactly.
      if (!emptyBlock && !between.endsWith(eol)) return noFrontmatter;
      const frontmatter = between.slice(0, between.length - (emptyBlock ? 0 : eol.length));
      const closingEnd = atEnd ? content.length : lineEnd + 1;
      const closingTerminator = content.slice(lineStart + line.length, closingEnd);
      if (closingTerminator !== "" && closingTerminator !== eol) return noFrontmatter;
      return {
        frontmatter,
        body: content.slice(closingEnd),
        layout: { eol, bom, closingLine: line, closingEol: closingTerminator !== "", emptyBlock },
      };
    }
    if (atEnd) break;
    lineStart = lineEnd + 1;
  }
  return noFrontmatter;
}

/**
 * Joins front matter and body. With `null` front matter the result is the body alone. With the
 * layout from `splitFrontmatter` and unchanged parts, the result is the original text.
 */
export function joinFrontmatter(frontmatter: string | null, body: string, layout?: FrontmatterLayout): string {
  if (frontmatter === null) return body;
  const l = layout ?? defaultLayout(detectEol(body));
  const inner = frontmatter === "" && l.emptyBlock ? "" : frontmatter + l.eol;
  const closingEol = l.closingEol || body !== "" ? l.eol : "";
  return `${l.bom ? BOM : ""}---${l.eol}${inner}${l.closingLine}${closingEol}${body}`;
}

export interface YamlProblem {
  message: string;
  /** 1-based line number within the front matter, when known. */
  line?: number;
}

/**
 * Checks front matter for YAML syntax errors. Front matter has no schema and is saved as typed
 * even when invalid; this only drives a warning marker.
 */
export function checkYaml(frontmatter: string): YamlProblem[] {
  const doc = parseDocument(frontmatter, { prettyErrors: false });
  return doc.errors.map((error) => ({
    message: error.message.split("\n")[0] ?? error.message,
    line: error.linePos?.[0]?.line,
  }));
}
