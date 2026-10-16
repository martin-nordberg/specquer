import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, mock, test } from "bun:test";
import type { Tree } from "@specquer/shared/api";
import { defaultUiState } from "@specquer/shared/uistate";
import type { Api } from "@/lib/api";
import { App } from "./App";

function fakeApi() {
  const view = { root: { kind: "folder" as const, name: "", path: "", children: [{ kind: "file" as const, name: "a.md", path: "a.md" }] }, truncated: false };
  const tree: Tree = { specs: view, all: view };
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
  const view: Tree["specs"] = {
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
  const tree: Tree = { specs: view, all: view };
  const patches: unknown[] = [];
  const readFile = mock(async (path: string) => ({ path, text: `# ${path}\n\nText\n`, version: "v1" }));
  const searchSections = mock(async () => [{ id: "SPEC-00001", path: "b.md", title: "Moved", kind: "heading", uid: null, depth: 1 }]);
  const citations = [
    { n: 1, path: "a.md", outlinePath: "0", sectionId: "SPEC-00001", title: "Moved" },
    { n: 2, path: "gone.md", outlinePath: "0", title: "Gone" },
  ];
  const api = {
    getUiState: async () => ({ ...defaultUiState(), currentFile: "a.md", sidePane: "chat" }),
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

function allFilesApi(uiState: Partial<ReturnType<typeof defaultUiState>> = {}) {
  const md = { kind: "file" as const, name: "a.md", path: "a.md" };
  const ts = { kind: "file" as const, name: "index.ts", path: "index.ts" };
  const tree: Tree = {
    specs: { root: { kind: "folder", name: "", path: "", children: [md] }, truncated: false },
    all: { root: { kind: "folder", name: "", path: "", children: [md, ts] }, truncated: false },
  };
  const patches: Array<Record<string, unknown>> = [];
  const getTree = mock(async () => tree);
  const readView = mock(async (path: string) => ({ kind: "text" as const, path, text: "export const x = 1;\n", size: 20, version: "t1" }));
  const saveFile = mock(async () => ({ kind: "saved" as const, version: "v2" }));
  const api = {
    getUiState: async () => ({ ...defaultUiState(), currentFile: "a.md", ...uiState }),
    getTree,
    readFile: async (path: string) => ({ path, text: "# A\n\nText\n", version: "v1" }),
    readView,
    saveFile,
    patchUiState: async (patch: Record<string, unknown>) => {
      patches.push(patch);
      return defaultUiState();
    },
    getSections: async () => [],
    sectionStatuses: async () => ({ sectioned: false, folderPrefix: null, statusValues: {} }),
    searchSections: async () => [],
    summaryStatus: async () => ({ enabled: false, problem: "No model is configured." }),
  } as unknown as Api;
  return { api, getTree, readView, saveFile, patches };
}

test("the folder pane switches to All Files without asking the server, and the open file stays (Step 014, R1)", async () => {
  const { api, getTree, patches } = allFilesApi();
  render(<App api={api} />);
  const views = await screen.findByRole("radiogroup", { name: "Files shown" });
  expect(screen.queryByRole("treeitem", { name: "index.ts" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "All Files" }));
  expect(await screen.findByRole("treeitem", { name: "index.ts" })).toBeTruthy();
  expect(views.querySelector('[aria-checked="true"]')!.textContent).toBe("All Files");
  expect(getTree).toHaveBeenCalledTimes(1);
  // The document is still open and selected
  expect(screen.getByRole("treeitem", { name: "a.md" }).getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(patches.some((patch) => patch.treeView === "all")).toBe(true));
});

test("a text file opens view-only after the document is saved, and a document opens again after it (Step 014, R3)", async () => {
  const { api, readView, saveFile } = allFilesApi({ treeView: "all", sidePane: "comments" });
  render(<App api={api} />);
  await screen.findByRole("status", { name: "Save status" });
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "More\n" } }));
  fireEvent.click(screen.getByText("index.ts"));
  const code = await screen.findByTestId("code-view");
  expect(saveFile).toHaveBeenCalledTimes(1);
  expect(readView).toHaveBeenCalledWith("index.ts");
  await waitFor(() => expect(code.querySelector(".code-text code")?.textContent).toBe("export const x = 1;"));
  // No save status, view selector or front matter for a file shown view-only
  expect(screen.queryByRole("status", { name: "Save status" })).toBeNull();
  expect(screen.queryByRole("radiogroup", { name: "View" })).toBeNull();
  expect(screen.getByRole("treeitem", { name: "index.ts" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("Comments are available for Markdown files in sectioned folders.")).toBeTruthy();
  fireEvent.click(screen.getByText("a.md"));
  expect(await screen.findByRole("status", { name: "Save status" })).toBeTruthy();
  expect(screen.queryByTestId("code-view")).toBeNull();
});

test("a text file that was open last time opens again at start-up", async () => {
  const { api, readView } = allFilesApi({ currentFile: "index.ts" });
  render(<App api={api} />);
  expect(await screen.findByTestId("code-view")).toBeTruthy();
  expect(readView).toHaveBeenCalledWith("index.ts");
});

test("an action that doesn't apply says why instead of opening its dialog (Step 015)", async () => {
  const { api } = allFilesApi({ treeView: "all" });
  const rename = mock(async () => ({ kind: "renamed" as const }));
  (api as unknown as { rename: typeof rename }).rename = rename;
  render(<App api={api} />);
  fireEvent.contextMenu(await screen.findByText("index.ts"));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Rename…" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename file" });
  expect(dialog.textContent).toContain("Specquer renames and deletes only Markdown files. Rename “index.ts” outside Specquer.");
  expect(screen.queryByRole("textbox", { name: "New name" })).toBeNull();
  expect(rename).not.toHaveBeenCalled();
});

test("the Outline is one of three side panes, and shows the open document's headings (Step 016)", async () => {
  const { api, patches } = allFilesApi({ sidePane: "comments" });
  render(<App api={api} />);
  const outline = await screen.findByRole("button", { name: "Outline" });
  fireEvent.click(outline);
  expect(outline.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Comments" }).getAttribute("aria-pressed")).toBe("false");
  expect(await screen.findByRole("treeitem", { name: "A" })).toBeTruthy();
  await waitFor(() => expect(patches.some((patch) => patch.sidePane === "outline")).toBe(true));
});
