import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import type { SummarizedSection } from "@specquer/shared/markdown";
import { TopPositionStore } from "@/app/top-position";
import { OutlinePane, type OutlinePaneProps } from "./OutlinePane";
import { OutlineToggle } from "./OutlineToggle";

const anchor = (id: string, uid: string) => `<a id="${id}" data-uid="${uid}"></a>`;
const SECTIONED = [
  anchor("REQ-00001", "docroot00001"),
  "",
  anchor("REQ-00002", "uidone000001"),
  "# One",
  "",
  anchor("REQ-00003", "uidonea00001"),
  "## One A",
  "",
  `- ${anchor("REQ-00004", "uiditem00001")} An item`,
  "",
  anchor("REQ-00005", "uidtwo000001"),
  "# Two",
  "",
].join("\n");

function setup(overrides: Partial<OutlinePaneProps> = {}) {
  const props: OutlinePaneProps = {
    document: { path: "docs/a.md", body: SECTIONED, sectioned: true, savedVersion: "v1" },
    notMarkdown: false,
    statusLists: { sectioned: true, folderPrefix: "REQ", statusValues: {} },
    loadSections: async () => [],
    summarized: [],
    collapsed: [],
    onCollapse: mock(() => {}),
    onPrune: mock(() => {}),
    topPositions: new TopPositionStore(),
    onMove: mock(() => {}),
    onAddAnchors: mock(() => {}),
    ...overrides,
  };
  return { props, ...render(<OutlinePane {...props} />) };
}

const item = (name: string) => screen.getByRole("treeitem", { name });

describe("OutlinePane (Step 016)", () => {
  test("a sectioned document's sections, nested, with badges; list items by ID and words", async () => {
    setup();
    await screen.findByRole("tree", { name: "Outline" });
    expect(screen.getAllByRole("treeitem").map((row) => row.getAttribute("aria-label"))).toEqual(["One", "One A", "REQ-00004 An item", "Two"]);
    expect(item("One A").getAttribute("aria-level")).toBe("2");
    expect(item("REQ-00004 An item").getAttribute("aria-level")).toBe("3");
    expect(item("Two").querySelector("img")).not.toBeNull();
  });

  test("a document that isn't sectioned shows its headings with a heading icon", async () => {
    setup({ document: { path: "notes/a.md", body: SECTIONED, sectioned: false, savedVersion: "v1" } });
    await screen.findByRole("tree", { name: "Outline" });
    expect(screen.getAllByRole("treeitem").map((row) => row.getAttribute("aria-label"))).toEqual(["One", "One A", "Two"]);
    expect(item("One").querySelector("img")).toBeNull();
    expect(item("One").querySelector("svg.lucide-heading")).not.toBeNull();
  });

  test("the icon and indentation collapse; the text moves the file pane and highlights", async () => {
    const { props } = setup();
    await screen.findByRole("tree", { name: "Outline" });
    fireEvent.click(item("One").querySelector('[data-part="toggle"]')!);
    expect(props.onCollapse).toHaveBeenCalledWith("uidone000001", true);
    fireEvent.click(item("One A").querySelector('[data-part="text"]')!);
    expect((props.onMove as ReturnType<typeof mock>).mock.calls[0]![0]).toMatchObject({ key: "uidonea00001", sectionId: "REQ-00003" });
    expect(item("One A").getAttribute("aria-selected")).toBe("true");
  });

  test("collapsed items hide what is below them, and the highlight inside shows on them", async () => {
    const topPositions = new TopPositionStore();
    setup({ collapsed: ["uidone000001"], topPositions });
    await screen.findByRole("tree", { name: "Outline" });
    expect(screen.queryByRole("treeitem", { name: "One A" })).toBeNull();
    expect(item("One").getAttribute("aria-expanded")).toBe("false");
    act(() => topPositions.set({ uid: "uiditem00001", outlinePath: "0.0" }));
    expect(item("One").getAttribute("aria-selected")).toBe("true");
    act(() => topPositions.set({ uid: "uidtwo000001", outlinePath: "1" }));
    expect(item("Two").getAttribute("aria-selected")).toBe("true");
    expect(item("One").getAttribute("aria-selected")).toBe("false");
  });

  test("the keyboard moves, expands, collapses and moves the file pane", async () => {
    const { props } = setup();
    await screen.findByRole("tree", { name: "Outline" });
    const one = item("One");
    expect(one.getAttribute("tabindex")).toBe("0");
    act(() => one.focus());
    fireEvent.keyDown(one, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("One A"));
    fireEvent.keyDown(item("One A"), { key: "ArrowLeft" });
    expect(props.onCollapse).toHaveBeenCalledWith("uidonea00001", true);
    fireEvent.keyDown(item("One A"), { key: "End" });
    expect(document.activeElement).toBe(item("Two"));
    fireEvent.keyDown(item("Two"), { key: "Enter" });
    expect((props.onMove as ReturnType<typeof mock>).mock.calls[0]![0]).toMatchObject({ key: "uidtwo000001" });
  });

  test("summarized sections stay, marked, without what is below them; the whole document summarized says so", async () => {
    const section = (path: string, document = false): SummarizedSection => ({ path, document, heading: null, range: { from: 0, to: 0 }, headings: [] });
    const { rerender, props } = setup({ summarized: [section("0")] });
    await screen.findByRole("tree", { name: "Outline" });
    expect(screen.getAllByRole("treeitem").map((row) => row.getAttribute("aria-label"))).toEqual(["One", "Two"]);
    expect(within(item("One")).getByText("summary")).toBeTruthy();
    expect(item("One").getAttribute("aria-expanded")).toBeNull();
    rerender(<OutlinePane {...props} summarized={[section("", true)]} />);
    expect(screen.getByText("The whole document is summarized. Move the summary slider to see its sections.")).toBeTruthy();
  });

  test("messages for no file, a file that isn't Markdown and a document without headings; the link", async () => {
    const { rerender, props } = setup({ document: null });
    expect(screen.getByText("Open a document to see its outline.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add section anchors…" })).toBeNull();
    rerender(<OutlinePane {...props} notMarkdown />);
    expect(screen.getByText("(Not Markdown)")).toBeTruthy();
    rerender(<OutlinePane {...props} document={{ path: "a.md", body: "Just text.\n", sectioned: false, savedVersion: "v" }} />);
    await waitFor(() => expect(screen.getByText("This document has no headings.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add section anchors…" }));
    expect(props.onAddAnchors).toHaveBeenCalled();
  });

  test("collapsed keys no longer in the document are pruned once when it opens", async () => {
    const { props } = setup({ collapsed: ["uidone000001", "gone00000001"] });
    await waitFor(() => expect(props.onPrune).toHaveBeenCalledTimes(1));
    const keys = (props.onPrune as ReturnType<typeof mock>).mock.calls[0]![0] as ReadonlySet<string>;
    expect(keys.has("uidone000001")).toBe(true);
    expect(keys.has("gone00000001")).toBe(false);
  });
});

test("the toggle's tooltip says what a click does, as its peers' do", () => {
  const { rerender } = render(<OutlineToggle open={false} onChange={() => {}} />);
  expect(screen.getByRole("button", { name: "Outline" }).getAttribute("title")).toBe("Open the outline");
  rerender(<OutlineToggle open onChange={() => {}} />);
  expect(screen.getByRole("button", { name: "Outline" }).getAttribute("title")).toBe("Close the outline");
});
