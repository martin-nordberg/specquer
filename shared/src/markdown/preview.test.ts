import { expect, test } from "bun:test";
import type { Element, Root, RootContent } from "hast";
import { markdownToHast } from "./preview.ts";

function find(node: Root | Element, tagName: string): Element[] {
  const found: Element[] = [];
  const walk = (n: Root | Element | RootContent) => {
    if (n.type === "element" && n.tagName === tagName) found.push(n);
    if ("children" in n) for (const c of n.children) walk(c);
  };
  walk(node);
  return found;
}

function text(node: Root | Element | RootContent): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(text).join("") : "";
}

test("renders GFM", () => {
  const tree = markdownToHast("# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~\n");
  expect(find(tree, "h1")).toHaveLength(1);
  expect(find(tree, "table")).toHaveLength(1);
  expect(find(tree, "input")[0]?.properties).toMatchObject({ type: "checkbox", checked: true, disabled: true });
  expect(find(tree, "del")).toHaveLength(1);
});

test("leaves front matter out", () => {
  const tree = markdownToHast("---\nsecret: yes\n---\n# T\n");
  expect(text(tree)).not.toContain("secret");
  expect(find(tree, "h1")).toHaveLength(1);
});

test("keeps traceability anchors, prefixed against clobbering", () => {
  const tree = markdownToHast('# Req <a name="r7k2" data-status="draft"></a>\n\n[link](#r7k2)\n');
  const anchors = find(tree, "a");
  expect(anchors[0]?.properties).toMatchObject({ name: "user-content-r7k2", dataStatus: "draft" });
  expect(anchors[1]?.properties.href).toBe("#user-content-r7k2");
  expect(text(find(tree, "h1")[0]!)).toBe("Req ");
});

test("strips dangerous HTML", () => {
  const tree = markdownToHast('<img src="x" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n<iframe src="https://evil"></iframe>\n');
  expect(find(tree, "script")).toHaveLength(0);
  expect(find(tree, "iframe")).toHaveLength(0);
  const img = find(tree, "img")[0];
  expect(img?.properties.onError).toBeUndefined();
  expect(img?.properties.onerror).toBeUndefined();
  expect(find(tree, "a")[0]?.properties.href).toBeUndefined();
});
