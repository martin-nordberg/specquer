import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, mock, test } from "bun:test";
import type { Tree } from "@specquer/shared/api";
import { defaultUiState } from "@specquer/shared/uistate";
import type { Api } from "@/lib/api";
import { App } from "./App";

function fakeApi() {
  const tree: Tree = { root: { kind: "folder", name: "", path: "", children: [{ kind: "file", name: "a.md", path: "a.md" }] }, truncated: false };
  const saveFile = mock(async () => ({ kind: "saved" as const, version: "v2" }));
  const api = {
    getUiState: async () => ({ ...defaultUiState(), currentFile: "a.md" }),
    getTree: async () => tree,
    readFile: async () => ({ path: "a.md", text: "# A\n\nText\n", version: "v1" }),
    saveFile,
    patchUiState: async () => defaultUiState(),
    getSections: async () => [],
    searchSections: async () => [],
    summaryStatus: async () => ({ enabled: false, problem: "No model is configured." }),
    summarize: async () => {
      throw new Error("not expected");
    },
  } as unknown as Api;
  return { api, saveFile };
}

test("the save status is a button that saves now only while there are unsaved changes", async () => {
  const { api, saveFile } = fakeApi();
  render(<App api={api} />);
  const status = () => screen.getByRole("status", { name: "Save status" });
  await waitFor(() => expect(status().textContent).toBe("Saved"));
  expect(screen.queryByRole("button", { name: "Unsaved changes: save now" })).toBeNull();

  const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "More\n" } }));
  const button = await screen.findByRole("button", { name: "Unsaved changes: save now" });
  fireEvent.click(button);
  await waitFor(() => expect(status().textContent).toBe("Saved"));
  expect(saveFile).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Unsaved changes: save now" })).toBeNull();
});
