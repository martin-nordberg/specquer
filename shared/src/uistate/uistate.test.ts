import { describe, expect, test } from "bun:test";
import {
  MAX_RECENT_FILES,
  MIN_FILE_PANE_FRACTION,
  paneWidths,
  setSidePane,
  toggleSidePane,
  setCommentsPaneFraction,
  setCommentFilter,
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
  setTreeView,
  setOutlinePaneFraction,
  setOutlineCollapsed,
  pruneOutlineCollapsed,
  setViewType,
  summaryStopOf,
} from "./uistate.ts";

describe("parseUiState", () => {
  test("defaults for missing or invalid content", () => {
    expect(parseUiState(undefined)).toEqual(defaultUiState());
    expect(parseUiState("garbage")).toEqual(defaultUiState());
  });

  test("the Outline pane: its side pane value, width and collapsed items (Step 016)", () => {
    expect(parseUiState({ sidePane: "outline" }).sidePane).toBe("outline");
    expect(defaultUiState().outlinePaneFraction).toBe(0.3);
    expect(parseUiState({ outlinePaneFraction: 0.9 }).outlinePaneFraction).toBe(0.3);
    expect(setOutlinePaneFraction(defaultUiState(), 0.9).outlinePaneFraction).toBe(0.5);
    let state = setOutlineCollapsed(defaultUiState(), "a.md", "uid000000001", true);
    state = setOutlineCollapsed(state, "a.md", "path:0.1", true);
    expect(state.files["a.md"]?.outlineCollapsed).toEqual(["uid000000001", "path:0.1"]);
    expect(setOutlineCollapsed(state, "a.md", "path:0.1", true)).toBe(state);
    expect(parseUiState({ files: { "a.md": { viewType: "split", outlineCollapsed: ["x", 3, "x"] } } }).files["a.md"]?.outlineCollapsed).toEqual(["x"]);
    state = pruneOutlineCollapsed(state, "a.md", new Set(["path:0.1"]));
    expect(state.files["a.md"]?.outlineCollapsed).toEqual(["path:0.1"]);
    state = setOutlineCollapsed(state, "a.md", "path:0.1", false);
    expect(state.files["a.md"]).toEqual({ viewType: "text" });
    expect(diffUiState(defaultUiState(), setOutlinePaneFraction(defaultUiState(), 0.4))).toEqual({ outlinePaneFraction: 0.4 });
  });

  test("the folder pane's view defaults to specs, and an invalid one becomes specs (Step 014)", () => {
    expect(defaultUiState().treeView).toBe("specs");
    expect(parseUiState({ treeView: "all" }).treeView).toBe("all");
    expect(parseUiState({ treeView: "everything" }).treeView).toBe("specs");
    const state = setTreeView(defaultUiState(), "all");
    expect(diffUiState(defaultUiState(), state)).toEqual({ treeView: "all" });
    expect(applyUiStatePatch(defaultUiState(), { treeView: "all" }).treeView).toBe("all");
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

describe("the side pane: chat or comments (Steps 010, 012)", () => {
  test("is closed at 0.3 by default, and invalid values fall back alone", () => {
    expect(defaultUiState()).toMatchObject({ sidePane: null, chatPaneFraction: 0.3, commentsPaneFraction: 0.3, commentFilter: "open" });
    const state = parseUiState({ sidePane: "yes", chatPaneFraction: 0.9, commentFilter: "mine", treePaneFraction: 0.4 });
    expect(state).toMatchObject({ sidePane: null, chatPaneFraction: 0.3, commentFilter: "open", treePaneFraction: 0.4 });
    expect(parseUiState({ sidePane: "comments", commentsPaneFraction: 0.2, commentFilter: "all" })).toMatchObject({
      sidePane: "comments",
      commentsPaneFraction: 0.2,
      commentFilter: "all",
    });
  });

  test("an open chat from before Step 012 stays open", () => {
    expect(parseUiState({ chatOpen: true })).toMatchObject({ sidePane: "chat" });
    expect(parseUiState({ chatOpen: false })).toMatchObject({ sidePane: null });
    expect(parseUiState({ chatOpen: true, sidePane: "comments" })).toMatchObject({ sidePane: "comments" });
    expect(parseUiState({ chatOpen: true })).not.toHaveProperty("chatOpen");
  });

  test("the icons toggle three ways: chat, comments, neither", () => {
    const chat = toggleSidePane(defaultUiState(), "chat");
    expect(chat.sidePane).toBe("chat");
    expect(toggleSidePane(chat, "comments").sidePane).toBe("comments");
    expect(toggleSidePane(chat, "chat").sidePane).toBeNull();
  });

  test("setters clamp, and patches carry the fields", () => {
    const open = setSidePane(defaultUiState(), "chat");
    expect(setChatPaneFraction(open, 0.9).chatPaneFraction).toBe(0.5);
    expect(setChatPaneFraction(open, 0.01).chatPaneFraction).toBe(0.15);
    expect(setCommentsPaneFraction(open, 0.9).commentsPaneFraction).toBe(0.5);
    const patch = diffUiState(defaultUiState(), setCommentFilter(setChatPaneFraction(open, 0.4), "resolved"));
    expect(patch).toEqual({ sidePane: "chat", chatPaneFraction: 0.4, commentFilter: "resolved" });
    expect(applyUiStatePatch(defaultUiState(), patch)).toMatchObject({ sidePane: "chat", chatPaneFraction: 0.4, commentFilter: "resolved" });
    expect(applyUiStatePatch(open, { sidePane: null }).sidePane).toBeNull();
  });

  test("paneWidths keeps the file pane at 30% or more, the chat pane giving way first", () => {
    const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);
    const check = (tree: number, chat: number, open: boolean, expected: [number, number]) => {
      const widths = paneWidths(tree, chat, open);
      close(widths.tree, expected[0]);
      close(widths.right, expected[1]);
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
