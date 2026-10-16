import { expect, test } from "bun:test";
import type { Element, Root, RootContent } from "hast";
import { highlightedCodeFileToHast, highlightedMarkdownToHast } from "./highlight.ts";
import { codeFileToHast, markdownToHast } from "./preview.ts";
import { LONG_LINE } from "./languages.ts";

function elements(node: Root | RootContent, out: Element[] = []): Element[] {
  if (node.type === "element") out.push(node);
  if ("children" in node) for (const child of node.children) elements(child, out);
  return out;
}
const classes = (node: Element) => (Array.isArray(node.properties.className) ? node.properties.className.map(String) : []);
const codes = (tree: Root) => elements(tree).filter((node) => node.tagName === "code");
const spans = (tree: Root) => elements(tree).filter((node) => node.tagName === "span" && classes(node).some((name) => name.startsWith("hljs-")));
const text = (node: Root | RootContent): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map(text).join("") : "";

test("fenced code in Markdown is highlighted by language name or alias, in any case", () => {
  for (const info of ["typescript", "ts", "TS", "Ts title=x"]) {
    const tree = highlightedMarkdownToHast(`\`\`\`${info}\nconst x: number = 1;\n\`\`\`\n`);
    expect([info, classes(codes(tree)[0]!)]).toEqual([info, ["hljs", `language-${info.split(" ")[0]!.toLowerCase()}`]]);
    expect(spans(tree).some((span) => classes(span).includes("hljs-keyword") && text(span) === "const")).toBe(true);
  }
});

test("code without a language, with an unknown one, indented, or with a long line stays plain", () => {
  for (const markdown of ["```\nconst x = 1;\n```\n", "```mermaid\ngraph TD; A-->B\n```\n", "    const x = 1;\n", `\`\`\`ts\nconst x = "${"y".repeat(LONG_LINE)}";\n\`\`\`\n`]) {
    const tree = highlightedMarkdownToHast(markdown);
    expect(spans(tree)).toEqual([]);
    expect(codes(tree)).toHaveLength(1);
  }
});

test("the plain pipeline doesn't highlight; inline code is never highlighted", () => {
  expect(spans(markdownToHast("```ts\nconst x = 1;\n```\n"))).toEqual([]);
  expect(spans(highlightedMarkdownToHast("Some `const x` here.\n"))).toEqual([]);
});

test("the sanitizer keeps highlight.js's classes and drops others, from raw HTML too", () => {
  const tree = highlightedMarkdownToHast('<span class="hljs-keyword evil">x</span> <code class="hljs other">y</code>\n\n```js\nclass A {}\n```\n');
  const raw = elements(tree).find((node) => node.tagName === "span" && text(node) === "x")!;
  expect(classes(raw)).toEqual(["hljs-keyword"]);
  expect(classes(codes(tree)[0]!)).toEqual(["hljs"]);
  // Modifiers such as `class_` in `hljs-title class_` survive
  expect(spans(tree).some((span) => classes(span).join(" ") === "hljs-title class_")).toBe(true);
});

test("a text file becomes a code block with a gutter of line numbers, never parsed as Markdown", () => {
  const file = "# Not a heading\n```\n<script>alert(1)</script>\n<a id=\"REQ-00001\"></a>\n";
  const tree = highlightedCodeFileToHast(file, undefined);
  const [wrapper] = tree.children as Element[];
  expect(classes(wrapper!)).toEqual(["code-file"]);
  const [gutter, block] = wrapper!.children as Element[];
  expect(gutter!.properties.ariaHidden).toBe("true");
  expect(text(gutter!)).toBe("1\n2\n3\n4");
  expect(text(block!)).toBe(file.slice(0, -1));
  expect(elements(tree).map((node) => node.tagName)).toEqual(["div", "pre", "pre", "code"]);
});

test("a text file with a language is highlighted, unless a line is long", () => {
  const tree = highlightedCodeFileToHast("def f():\n    return 1\n", "python");
  expect(classes(codes(tree)[0]!)).toEqual(["hljs", "language-python"]);
  expect(spans(tree).length).toBeGreaterThan(0);
  expect(spans(highlightedCodeFileToHast(`x = "${"y".repeat(LONG_LINE)}"\n`, "python"))).toEqual([]);
  // A language `common` lacks shows plain
  expect(spans(highlightedCodeFileToHast("FROM alpine\n", "dockerfile"))).toEqual([]);
});

test("without a highlighter, code shows plain with its numbers; an empty file has one line", () => {
  const tree = codeFileToHast("a\r\nb", "typescript");
  expect(spans(tree)).toEqual([]);
  expect(text((tree.children[0] as Element).children[0]!)).toBe("1\n2");
  expect(text((codeFileToHast("", undefined).children[0] as Element).children[0]!)).toBe("1");
});
