import { expect, test } from "bun:test";
import type { Element, Root, RootContent } from "hast";
import { commentToHast } from "./comment.ts";

function text(node: Root | RootContent): string {
  if (node.type === "text") return node.value;
  return "children" in node ? (node.children as RootContent[]).map(text).join("") : "";
}

function tags(node: Root | RootContent, found = new Set<string>()): Set<string> {
  if (node.type === "element") found.add((node as Element).tagName);
  if ("children" in node) for (const child of node.children as RootContent[]) tags(child, found);
  return found;
}

test("comments keep basic Markdown", () => {
  const tree = commentToHast("Some **bold**, `code` and\n\n- a list");
  expect([...tags(tree)].sort()).toEqual(["code", "li", "p", "strong", "ul"]);
});

test("links and images of every kind become their text and URL, never elements", () => {
  const markdown = [
    "[inline](https://a.example/x)",
    "[ref][r] and [collapsed][]",
    "![alt text](https://a.example/i.png) ![shot][img]",
    "<https://auto.example> and https://bare.example and www.www.example",
    "",
    "[r]: https://r.example",
    "[collapsed]: https://c.example",
    "[img]: https://img.example/s.png",
  ].join("\n");
  const tree = commentToHast(markdown);
  expect(tags(tree).has("a")).toBe(false);
  expect(tags(tree).has("img")).toBe(false);
  const shown = text(tree);
  expect(shown).toContain("inline (https://a.example/x)");
  expect(shown).toContain("ref (https://r.example) and collapsed (https://c.example)");
  expect(shown).toContain("alt text (https://a.example/i.png) shot (https://img.example/s.png)");
  expect(shown).toContain("https://auto.example and https://bare.example and www.www.example");
  // Definitions show nothing of their own
  expect(shown).not.toContain("[r]:");
});

test("raw HTML is shown as text, never parsed", () => {
  const tree = commentToHast('<img src="x" onerror="alert(1)"> and <b>bold</b>');
  expect(tags(tree).has("img")).toBe(false);
  expect(tags(tree).has("b")).toBe(false);
  expect(text(tree)).toContain('<img src="x" onerror="alert(1)">');
});
