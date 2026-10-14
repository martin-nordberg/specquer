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
    sectionStatuses: async () => ({ sectioned: false, folderPrefix: null, statusValues: {} }),
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

test("a citation opens its section's current file in Preview; one found nowhere is marked", async () => {
  const tree: Tree = {
    root: {
      kind: "folder",
      name: "",
      path: "",
      children: [
        { kind: "file", name: "a.md", path: "a.md" },
        { kind: "file", name: "b.md", path: "b.md" },
      ],
    },
    truncated: false,
  };
  const patches: unknown[] = [];
  const readFile = mock(async (path: string) => ({ path, text: `# ${path}\n\nText\n`, version: "v1" }));
  const searchSections = mock(async () => [{ id: "SPEC-00001", path: "b.md", title: "Moved", kind: "heading", uid: null, depth: 1 }]);
  const citations = [
    { n: 1, path: "a.md", outlinePath: "0", sectionId: "SPEC-00001", title: "Moved" },
    { n: 2, path: "gone.md", outlinePath: "0", title: "Gone" },
  ];
  const api = {
    getUiState: async () => ({ ...defaultUiState(), currentFile: "a.md", chatOpen: true }),
    getTree: async () => tree,
    readFile,
    saveFile: async () => ({ kind: "saved" as const, version: "v2" }),
    patchUiState: async (patch: unknown) => {
      patches.push(patch);
      return defaultUiState();
    },
    getSections: async () => [],
    sectionStatuses: async () => ({ sectioned: false, folderPrefix: null, statusValues: {} }),
    searchSections,
    summaryStatus: async () => ({ enabled: true, model: "m/x" }),
    chatHistory: async () => [
      {
        question: { text: "Where?", at: "2026-10-13T12:00:00.000Z" },
        answer: { text: "Here [1] and [2].", model: "m/x", elapsedMs: 1000, at: "2026-10-13T12:00:01.000Z", stopped: false, citations },
      },
    ],
  } as unknown as Api;
  render(<App api={api} />);
  const answer = await screen.findByRole("region", { name: "AI response" });
  expect(answer.textContent).toContain("(no longer exists)");
  fireEvent.click(screen.getAllByRole("button", { name: "[1]" })[0]!);
  await waitFor(() => expect(readFile).toHaveBeenCalledWith("b.md"));
  expect(searchSections).toHaveBeenCalledWith("SPEC-00001", { limit: 5 });
  await waitFor(() =>
    expect(patches.some((patch) => (patch as { files?: Record<string, { viewType: string }> }).files?.["b.md"]?.viewType === "preview")).toBe(true),
  );
});
