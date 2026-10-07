import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { expect, mock, test } from "bun:test";
import { sectionCompletionSource } from "./section-completion";

const result = { id: "SPEC-00003", uid: "u", kind: "heading" as const, title: "Details", path: "specs/anchored.md" };

async function complete(text: string, currentFile = "specs/links.md") {
  const search = mock(async (_q: string, _path?: string) => [result]);
  const state = EditorState.create({ doc: text });
  const source = sectionCompletionSource(search, () => currentFile);
  const completion = await source(new CompletionContext(state, text.length, false));
  return { completion, search };
}

test("offers sections of all documents after ](#, inserting the relative path", async () => {
  const { completion, search } = await complete("See [it](#Det");
  expect(search).toHaveBeenCalledWith("Det", undefined);
  expect(completion?.from).toBe("See [it](".length);
  expect(completion?.options[0]).toMatchObject({ label: "SPEC-00003", detail: "Details", apply: "anchored.md#SPEC-00003" });
  const same = await complete("See [it](#", "specs/anchored.md");
  expect(same.completion?.options[0]?.apply).toBe("#SPEC-00003");
});

test("offers one document's sections after ](path#", async () => {
  const { completion, search } = await complete("[x](../specs/anchored.md#SPEC-0", "notes/n.md");
  expect(search).toHaveBeenCalledWith("SPEC-0", "specs/anchored.md");
  expect(completion?.options[0]?.apply).toBe("../specs/anchored.md#SPEC-00003");
});

test("nothing outside link targets", async () => {
  expect((await complete("Heading #Det")).completion).toBeNull();
  expect((await complete("[x](http://example.com/#a")).completion).toBeNull();
});
