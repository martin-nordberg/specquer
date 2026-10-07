import { describe, expect, test } from "bun:test";
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

describe("section anchors", () => {
  const DOC = "tz4a98xxat96iws9zmbrgj3a";
  const marked = (tree: Root) =>
    find(tree, "a")
      .filter((a) => a.properties.dataSectionAnchor !== undefined)
      .map((a) => `${a.properties.dataSectionAnchor}:${a.properties.id}`);

  test("marks the root, heading and list item anchors", () => {
    const tree = markdownToHast(
      `<a id="RQ-00001" data-document-id="${DOC}"></a>\n\n<a id="RQ-00002"></a>\n# Title\n\nSetext <a id="X"></a>\n\n* <a id="RQ-00003"></a> one\n- [ ] <a id="RQ-00004"></a> task\n\n> <a id="RQ-00005"></a>\n> # quoted\n`,
    );
    expect(marked(tree)).toEqual([
      "root:user-content-RQ-00001",
      "heading:user-content-RQ-00002",
      "item:user-content-RQ-00003",
      "item:user-content-RQ-00004",
    ]);
  });

  test("moves a heading's anchor into the heading", () => {
    const tree = markdownToHast(`<a id="RQ-00001" data-document-id="${DOC}"></a>\n\n<a id="RQ-00002"></a>\n\n## Title\n`);
    const [h2] = find(tree, "h2");
    expect(find(h2!, "a")[0]?.properties.id).toBe("user-content-RQ-00002");
    expect(text(h2!)).toBe(" Title");
    expect(find(tree, "p")).toHaveLength(1);
  });

  test("a legacy first anchor directly before a heading is the heading's", () => {
    const tree = markdownToHast('<a id="RQ-00001"></a>\n# Title\n');
    expect(marked(tree)).toEqual(["heading:user-content-RQ-00001"]);
  });
});
