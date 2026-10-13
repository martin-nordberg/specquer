import { describe, expect, test } from "bun:test";
import {
  MAX_RECENT_FILES,
  MIN_FILE_PANE_FRACTION,
  paneWidths,
  setChatOpen,
  setChatPaneFraction,
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

describe("the chat pane (Step 010)", () => {
  test("is closed at 0.3 by default, and invalid values fall back alone", () => {
    expect(defaultUiState()).toMatchObject({ chatOpen: false, chatPaneFraction: 0.3 });
    const state = parseUiState({ chatOpen: "yes", chatPaneFraction: 0.9, treePaneFraction: 0.4 });
    expect(state).toMatchObject({ chatOpen: false, chatPaneFraction: 0.3, treePaneFraction: 0.4 });
    expect(parseUiState({ chatOpen: true, chatPaneFraction: 0.2 })).toMatchObject({ chatOpen: true, chatPaneFraction: 0.2 });
  });

  test("setters clamp, and patches carry the fields", () => {
    const open = setChatOpen(defaultUiState(), true);
    expect(open.chatOpen).toBe(true);
    expect(setChatPaneFraction(open, 0.9).chatPaneFraction).toBe(0.5);
    expect(setChatPaneFraction(open, 0.01).chatPaneFraction).toBe(0.15);
    const patch = diffUiState(defaultUiState(), setChatPaneFraction(open, 0.4));
    expect(patch).toEqual({ chatOpen: true, chatPaneFraction: 0.4 });
    expect(applyUiStatePatch(defaultUiState(), patch)).toMatchObject({ chatOpen: true, chatPaneFraction: 0.4 });
  });

  test("paneWidths keeps the file pane at 30% or more, the chat pane giving way first", () => {
    const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);
    const check = (tree: number, chat: number, open: boolean, expected: [number, number]) => {
      const widths = paneWidths(tree, chat, open);
      close(widths.tree, expected[0]);
      close(widths.chat, expected[1]);
      close(widths.file, 1 - expected[0] - expected[1]);
    };
    check(0.25, 0.3, true, [0.25, 0.3]);
    check(0.25, 0.3, false, [0.25, 0]);
    check(0.7, 0.3, false, [0.7, 0]);
    // The chat pane gives way first, down to its minimum
    check(0.5, 0.3, true, [0.5, 0.2]);
    // Then the folder pane
    check(0.7, 0.5, true, [0.55, 0.15]);
    for (const [tree, chat] of [[0.1, 0.5], [0.7, 0.15], [0.4, 0.4], [0.6, 0.5]] as const) {
      expect(paneWidths(tree, chat, true).file).toBeGreaterThanOrEqual(MIN_FILE_PANE_FRACTION - 1e-9);
    }
  });
});
