import { describe, expect, test } from "bun:test";
import {
  MAX_RECENT_FILES,
  applyUiStatePatch,
  defaultUiState,
  deleteInUiState,
  diffUiState,
  openFile,
  parseUiState,
  pruneMissing,
  renameInUiState,
  setFolderExpanded,
  setSummaryStop,
  setTreePaneFraction,
  setViewType,
  summaryStopOf,
} from "./uistate.ts";

describe("parseUiState", () => {
  test("defaults for missing or invalid content", () => {
    expect(parseUiState(undefined)).toEqual(defaultUiState());
    expect(parseUiState("garbage")).toEqual(defaultUiState());
  });

  test("keeps valid fields and replaces invalid ones", () => {
    const state = parseUiState({
      version: 99,
      theme: "purple",
      treePaneFraction: 0.4,
      expandedFolders: ["a", 3, "a"],
      recentFiles: Array.from({ length: 15 }, (_, i) => `f${i}.md`),
      files: { "a.md": { viewType: "split", frontmatterHeight: 80 }, "b.md": "bad", "c.md": { viewType: "nope" } },
      unknown: true,
    });
    expect(state.version).toBe(1);
    expect(state.theme).toBeUndefined();
    expect(state.treePaneFraction).toBe(0.4);
    expect(state.expandedFolders).toEqual(["a"]);
    expect(state.recentFiles).toHaveLength(MAX_RECENT_FILES);
    expect(state.files).toEqual({ "a.md": { viewType: "split", frontmatterHeight: 80 }, "c.md": { viewType: "text" } });
    expect("unknown" in state).toBe(false);
  });
});

test("openFile keeps recent files most recent first, without the current file", () => {
  let state = defaultUiState();
  state = openFile(state, "a.md");
  expect(state.recentFiles).toEqual([]);
  state = openFile(state, "b.md");
  state = openFile(state, "c.md");
  expect(state.recentFiles).toEqual(["b.md", "a.md"]);
  state = openFile(state, "a.md");
  expect(state).toMatchObject({ currentFile: "a.md", recentFiles: ["c.md", "b.md"] });
  for (let i = 0; i < 20; i++) state = openFile(state, `x${i}.md`);
  expect(state.recentFiles).toHaveLength(MAX_RECENT_FILES);
});

test("rename rewrites every affected entry", () => {
  let state = defaultUiState();
  state = setFolderExpanded(state, "docs", true);
  state = setFolderExpanded(state, "docs/sub", true);
  state = setFolderExpanded(state, "docsx", true);
  state = openFile(state, "docs/sub/a.md");
  state = setViewType(state, "docs/sub/a.md", "preview");
  state = openFile(state, "docsx/b.md");
  state = renameInUiState(state, "docs", "specs");
  expect(state.expandedFolders).toEqual(["specs", "specs/sub", "docsx"]);
  expect(state.recentFiles).toEqual(["specs/sub/a.md"]);
  expect(state.currentFile).toBe("docsx/b.md");
  expect(state.files["specs/sub/a.md"]?.viewType).toBe("preview");
});

test("delete removes every affected entry", () => {
  let state = defaultUiState();
  state = setFolderExpanded(state, "docs", true);
  state = openFile(state, "docs/a.md");
  state = setViewType(state, "docs/a.md", "split");
  state = openFile(state, "b.md");
  state = deleteInUiState(state, "docs");
  expect(state).toMatchObject({ expandedFolders: [], recentFiles: [], currentFile: "b.md", files: {} });
  expect(deleteInUiState(state, "b.md").currentFile).toBeUndefined();
});

test("pruneMissing drops entries for vanished files and folders", () => {
  let state = defaultUiState();
  state = setFolderExpanded(state, "gone", true);
  state = setFolderExpanded(state, "here", true);
  state = openFile(state, "here/a.md");
  state = openFile(state, "gone.md");
  const kinds: Record<string, "file" | "folder"> = { here: "folder", "here/a.md": "file" };
  state = pruneMissing(state, (p) => kinds[p]);
  expect(state).toMatchObject({ expandedFolders: ["here"], recentFiles: ["here/a.md"], currentFile: undefined });
});

test("patches and diffs", () => {
  const a = defaultUiState();
  const b = setTreePaneFraction(openFile({ ...a, theme: "dark" }, "x.md"), 5);
  expect(b.treePaneFraction).toBe(0.7);
  const patch = diffUiState(a, b);
  expect(patch).toEqual({ theme: "dark", treePaneFraction: 0.7, currentFile: "x.md" });
  expect(applyUiStatePatch(a, patch)).toEqual(b);
  expect(applyUiStatePatch(b, { theme: null, currentFile: null })).toMatchObject({ theme: undefined, currentFile: undefined });
});

describe("summaryStop", () => {
  test("is parsed on its own, so a damaged value falls back alone", () => {
    const state = parseUiState({ files: { "a.md": { viewType: "split", summaryStop: 2 }, "b.md": { viewType: "preview", summaryStop: -1 }, "c.md": { viewType: "split", summaryStop: 1.5 } } });
    expect(state.files).toEqual({ "a.md": { viewType: "split", summaryStop: 2 }, "b.md": { viewType: "preview" }, "c.md": { viewType: "split" } });
  });

  test("is stored as steps from the full text and clamped to the document's stops", () => {
    let state = setSummaryStop(defaultUiState(), "a.md", 2);
    expect(state.files["a.md"]).toEqual({ viewType: "text", summaryStop: 2 });
    // 5 stops (0 to 4): two steps from the full text is stop 2
    expect(summaryStopOf(state.files["a.md"]!, 5)).toBe(2);
    // A document with fewer stops clamps to the whole document
    expect(summaryStopOf(state.files["a.md"]!, 2)).toBe(0);
    expect(summaryStopOf({ viewType: "text" }, 4)).toBe(3);
    state = setSummaryStop(state, "a.md", 0);
    expect(state.files["a.md"]).toEqual({ viewType: "text" });
    expect(setSummaryStop(state, "a.md", 99).files["a.md"]?.summaryStop).toBe(7);
  });
});
