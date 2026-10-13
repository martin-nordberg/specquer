import { expect, test } from "bun:test";
import type { Element, ElementContent, Root } from "hast";
import { CITATION_TAG, answerToHast } from "./answer.ts";

/** The tree as compact HTML-like text, for readable assertions. */
function html(tree: Root | Element | ElementContent): string {
  if (tree.type === "text") return tree.value;
  if (tree.type !== "root" && tree.type !== "element") return "";
  const children = (tree.children as ElementContent[]).map(html).join("");
  if (tree.type === "root") return children;
  const props = Object.entries(tree.properties)
    .map(([key, value]) => ` ${key}="${Array.isArray(value) ? value.join(" ") : String(value)}"`)
    .join("");
  return `<${tree.tagName}${props}>${children}</${tree.tagName}>`;
}

const render = (markdown: string, citations: number[] = []) => html(answerToHast(markdown, citations)).replace(/\n/g, "");

test("keeps paragraphs, emphasis, lists, code, quotes and tables", () => {
  expect(render("Some **bold**, *italic* and ~~gone~~ `code`.")).toBe(
    "<p>Some <strong>bold</strong>, <em>italic</em> and <del>gone</del> <code>code</code>.</p>",
  );
  expect(render("- one\n- two\n  1. nested")).toBe("<ul><li>one</li><li>two<ol><li>nested</li></ol></li></ul>");
  expect(render("3. three\n4. four")).toBe('<ol start="3"><li>three</li><li>four</li></ol>');
  expect(render("```ts\nconst a = 1;\n```")).toBe('<pre><code className="language-ts">const a = 1;</code></pre>');
  expect(render("> quoted")).toBe("<blockquote><p>quoted</p></blockquote>");
  expect(render("| a | b |\n|:-|-:|\n| 1 | 2 |")).toBe(
    '<table><thead><tr><th align="left">a</th><th align="right">b</th></tr></thead><tbody><tr><td align="left">1</td><td align="right">2</td></tr></tbody></table>',
  );
});

test("headings become bold paragraphs", () => {
  expect(render("# Title\n\n## Sub *x*")).toBe("<p><strong>Title</strong></p><p><strong>Sub <em>x</em></strong></p>");
  expect(render("Setext\n===")).toBe("<p><strong>Setext</strong></p>");
});

test("raw HTML is shown as text, never as elements", () => {
  expect(render('Hi <img src=x onerror="alert(1)"> there')).toBe('<p>Hi <img src=x onerror="alert(1)"> there</p>');
  expect(answerToHast("<script>alert(1)</script>\n\n<div onclick=x>block</div>", []).children.some((n) => n.type === "element" && n.tagName !== "p")).toBe(false);
  expect(render("<script>alert(1)</script>")).toBe("<p><script>alert(1)</script></p>");
});

test("images, links and autolinks the model writes are text", () => {
  expect(render("See ![diagram](https://x.test/d.png).")).toBe("<p>See ![diagram](https://x.test/d.png).</p>");
  expect(render("[click](javascript:alert(1))")).toBe("<p>click (javascript:alert(1))</p>");
  expect(render("[docs](https://example.com/a)")).toBe("<p>docs (https://example.com/a)</p>");
  expect(render("Go to https://example.com now")).toBe("<p>Go to https://example.com now</p>");
  expect(render("[ref][r]\n\n[r]: https://x.test")).toBe("<p>[ref][r]</p><p>[r]: https://x.test</p>");
  const tree = answerToHast("[a](https://x.test) ![b](y.png) <a href='https://x.test'>c</a>", []);
  expect(JSON.stringify(tree)).not.toContain('"tagName":"a"');
  expect(JSON.stringify(tree)).not.toContain('"tagName":"img"');
});

test("footnotes are text", () => {
  expect(render("A note[^1].\n\n[^1]: The note.")).toBe("<p>A note[^1].</p><p>[^1]: The note.</p>");
});

test("only listed citation markers become citations", () => {
  expect(render("Copies get new IDs [1], see [2] and [3].", [1, 3])).toBe(
    `<p>Copies get new IDs <${CITATION_TAG} dataN="1">[1]</${CITATION_TAG}>, see [2] and <${CITATION_TAG} dataN="3">[3]</${CITATION_TAG}>.</p>`,
  );
  expect(render("- in a list [1]", [1])).toBe(`<ul><li>in a list <${CITATION_TAG} dataN="1">[1]</${CITATION_TAG}></li></ul>`);
});

test("markers in code stay text", () => {
  expect(render("`a[1]` and\n\n```\nb[1]\n```", [1])).toBe("<p><code>a[1]</code> and</p><pre><code>b[1]</code></pre>");
});

test("half-written Markdown, as it streams, stays text until it is finished", () => {
  expect(render("Some **bold")).toBe("<p>Some **bold</p>");
  expect(render("- item\n-")).toBe("<ul><li>item</li><li></li></ul>");
  expect(render("| a | b |\n|-")).toBe("<p>| a | b |\n|-</p>".replace(/\n/g, ""));
  expect(render("Cited [")).toBe("<p>Cited [</p>");
  expect(render("Cited [1", [1])).toBe("<p>Cited [1</p>");
});
