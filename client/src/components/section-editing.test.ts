import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Schema, Slice } from "@milkdown/kit/prose/model";
import { placeholdersForPastedCopies } from "./MilkdownEditor";
import { PLACEHOLDER, placeholderChanges, sectionAnchorsIn, sectionEditing } from "./section-editing";

const anchor = (id: string, uid = "u1") => `<a id="${id}" data-uid="${uid}"></a>`;

test("finds anchors with section IDs and turns taken ones into placeholders", () => {
  const text = `${anchor("REQ-00001")}\n# A\n\n* ${anchor("REQ-00002")} item\n\n<a id="intro"></a> and <a name="x"></a>\n`;
  expect(sectionAnchorsIn(text).map((a) => a.id)).toEqual(["REQ-00001", "REQ-00002"]);
  const changes = placeholderChanges(text, (id) => id === "REQ-00002", 10);
  expect(changes).toEqual([{ from: 10 + text.indexOf("<a id=\"REQ-00002\""), to: 10 + text.indexOf(" item"), insert: PLACEHOLDER }]);
});

describe("pasting in the text editor", () => {
  const editor = (doc: string, lookup: (id: string) => Promise<boolean> = async () => false) => {
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [sectionEditing(lookup)] }) });
    const paste = (at: number, text: string, to = at) => view.dispatch({ changes: { from: at, to, insert: text }, userEvent: "input.paste" });
    return { view, paste, text: () => view.state.doc.toString() };
  };

  test("a pasted copy of an anchor in the document becomes a placeholder", () => {
    const original = `${anchor("REQ-00002")}\n# B\n`;
    const { paste, text } = editor(original);
    paste(original.length, `\n${original}`);
    expect(text()).toBe(`${original}\n${PLACEHOLDER}\n# B\n`);
  });

  test("a paste replacing the original (a cut and paste, or a move) keeps the ID", () => {
    const original = `${anchor("REQ-00002")}\n# B\n`;
    const { paste, text } = editor(`Intro\n\n${original}`);
    paste(0, original, `Intro\n\n${original}`.length);
    expect(text()).toBe(original);
  });

  test("typing an anchor isn't a paste", () => {
    const original = `${anchor("REQ-00002")}\n# B\n`;
    const { view, text } = editor(original);
    view.dispatch({ changes: { from: original.length, insert: anchor("REQ-00002") }, userEvent: "input.type" });
    expect(text()).toBe(`${original}${anchor("REQ-00002")}`);
  });

  test("an anchor whose ID another document holds becomes a placeholder once looked up", async () => {
    const looked: string[] = [];
    const { paste, text } = editor("# Here\n", async (id) => {
      looked.push(id);
      return id === "REQ-00005";
    });
    paste(0, `${anchor("REQ-00005")}\n# Copied\n\n${anchor("REQ-00006", "u2")}\n# Moved\n\n`);
    await Bun.sleep(0);
    expect(looked.sort()).toEqual(["REQ-00005", "REQ-00006"]);
    expect(text()).toBe(`${PLACEHOLDER}\n# Copied\n\n${anchor("REQ-00006", "u2")}\n# Moved\n\n# Here\n`);
  });
});

test("pasting in WYSIWYG: anchors the document holds become placeholders", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "inline*" },
      text: { group: "inline" },
      html: { group: "inline", inline: true, atom: true, attrs: { value: { default: "" } } },
    },
  });
  const html = (value: string) => schema.node("html", { value });
  const paragraph = (...content: Parameters<typeof schema.node>[2][]) => schema.node("paragraph", null, content.flat() as never);
  const doc = schema.node("doc", null, [paragraph(html('<a id="REQ-00002" data-uid="u2">'), html("</a>"), schema.text(" B"))]);
  const pasted = new Slice(
    schema.node("doc", null, [
      paragraph(html('<a id="REQ-00002" data-uid="u2">'), html("</a>"), schema.text(" copy")),
      paragraph(html('<a id="REQ-00009" data-uid="u9">'), html("</a>"), schema.text(" new")),
    ]).content,
    0,
    0,
  );
  const result = placeholdersForPastedCopies(pasted, doc);
  const values: string[] = [];
  result.content.descendants((node) => {
    if (node.type.name === "html") values.push(String(node.attrs.value));
  });
  expect(values).toEqual(['<a id="">', "</a>", '<a id="REQ-00009" data-uid="u9">', "</a>"]);
});
