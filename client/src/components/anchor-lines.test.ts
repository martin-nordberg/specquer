import { expect, test } from "bun:test";
import { Schema } from "@milkdown/kit/prose/model";
import { anchorLines, isAnchorLine, skipCollapsed } from "./anchor-lines";

// The node names and attributes Milkdown's CommonMark preset uses
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    text: { group: "inline" },
    html: { group: "inline", inline: true, atom: true, attrs: { value: { default: "" } } },
  },
});
const html = (value: string) => schema.nodes.html!.create({ value });
const anchor = (id: string) => [html(`<a id="${id}" data-uid="k1v2u0xwq8y7">`), html("</a>")];
const p = (...content: Parameters<typeof schema.nodes.paragraph.create>[1][]) => schema.nodes.paragraph!.create(null, content.flat() as never);
const h = (level: number, text: string) => schema.nodes.heading!.create({ level }, schema.text(text));

test("a paragraph holding only section anchors is an anchor line; one with text, other HTML or a placeholder isn't", () => {
  expect(isAnchorLine(p(anchor("REQ-00001")))).toBe(true);
  expect(isAnchorLine(p([...anchor("REQ-00001"), schema.text(" ")]))).toBe(true);
  expect(isAnchorLine(p([...anchor("REQ-00001"), schema.text(" item")]))).toBe(false);
  expect(isAnchorLine(p([html('<a id="intro">'), html("</a>")]))).toBe(false);
  expect(isAnchorLine(p([html('<a id="">'), html("</a>")]))).toBe(false);
  expect(isAnchorLine(p(schema.text("Text")))).toBe(false);
  expect(isAnchorLine(h(1, "Title"))).toBe(false);
});

test("anchor lines know the level of a heading right after them", () => {
  const doc = schema.nodes.doc!.create(null, [p(anchor("REQ-00001")), p(anchor("REQ-00002")), h(2, "Design"), p(schema.text("Intro."))]);
  const lines = anchorLines(doc);
  expect(lines.map((line) => line.headingLevel)).toEqual([undefined, 2]);
  expect(lines[0]!.from).toBe(0);
  expect(lines[1]!.from).toBe(lines[0]!.to);
});

test("the cursor skips a collapsed anchor line in the direction it moves", () => {
  const doc = schema.nodes.doc!.create(null, [p(schema.text("Intro.")), p(anchor("REQ-00002")), h(2, "Design")]);
  const line = anchorLines(doc)[0]!;
  const inside = line.from + 1;
  // Moving up: to the end of the paragraph before; moving down: into the heading
  expect(skipCollapsed(doc, inside, true)).toBe(1 + "Intro.".length);
  expect(skipCollapsed(doc, inside, false)).toBe(line.to + 1);
  // Outside a collapsed line nothing changes
  expect(skipCollapsed(doc, 1, true)).toBeUndefined();
  // A line not before a heading isn't collapsed
  const plain = schema.nodes.doc!.create(null, [p(anchor("REQ-00001")), p(schema.text("Text"))]);
  expect(skipCollapsed(plain, 1, true)).toBeUndefined();
});
