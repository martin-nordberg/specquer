import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import type { TreeFolder } from "@specquer/shared/api";
import { FileTree } from "./FileTree";


const root: TreeFolder = {
  kind: "folder",
  name: "",
  path: "",
  children: [
    {
      kind: "folder",
      name: "docs",
      path: "docs",
      children: [{ kind: "file", name: "a.md", path: "docs/a.md" }],
    },
    { kind: "file", name: "b.md", path: "b.md" },
  ],
};

function setup(expanded: string[] = []) {
  const handlers = {
    onToggleFolder: mock(() => {}),
    onOpenFile: mock(() => {}),
    onNewFile: mock(() => {}),
    onNewFolder: mock(() => {}),
    onRename: mock(() => {}),
    onDelete: mock(() => {}),
  };
  const result = render(<FileTree root={root} expanded={new Set(expanded)} currentFile="b.md" {...handlers} />);
  return { ...handlers, ...result };
}

describe("FileTree", () => {
  test("collapsed folders hide their children", () => {
    setup();
    expect(screen.queryByText("a.md")).toBeNull();
    expect(screen.getByRole("treeitem", { name: "docs" }).getAttribute("aria-expanded")).toBe("false");
  });

  test("expanded folders show their children", () => {
    setup(["docs"]);
    expect(screen.getByText("a.md")).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "docs" }).getAttribute("aria-expanded")).toBe("true");
  });

  test("clicking a folder toggles it; clicking a file opens it", () => {
    const { onToggleFolder, onOpenFile } = setup(["docs"]);
    fireEvent.click(screen.getByText("docs"));
    expect(onToggleFolder).toHaveBeenCalledWith("docs", false);
    fireEvent.click(screen.getByText("a.md"));
    expect(onOpenFile).toHaveBeenCalledWith("docs/a.md");
  });

  test("the current file is selected", () => {
    setup();
    expect(screen.getByRole("treeitem", { name: "b.md" }).getAttribute("aria-selected")).toBe("true");
  });

  test("the context menu offers Rename and Delete", async () => {
    const { onRename, onDelete } = setup();
    fireEvent.contextMenu(screen.getByText("b.md"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename…" }));
    expect(onRename).toHaveBeenCalledWith(root.children[1]);
    fireEvent.contextMenu(screen.getByText("docs"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    expect(onDelete).toHaveBeenCalledWith(root.children[0]);
  });

  test("folders offer New file and New folder; files don't", async () => {
    const { onNewFile, onNewFolder } = setup();
    fireEvent.contextMenu(screen.getByText("docs"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "New file…" }));
    expect(onNewFile).toHaveBeenCalledWith(root.children[0]);
    fireEvent.contextMenu(screen.getByText("docs"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "New folder…" }));
    expect(onNewFolder).toHaveBeenCalledWith(root.children[0]);
    fireEvent.contextMenu(screen.getByText("b.md"));
    await screen.findByRole("menuitem", { name: "Rename…" });
    expect(screen.queryByRole("menuitem", { name: "New file…" })).toBeNull();
  });

  test("the space below the last entry offers New file and New folder in the root", async () => {
    const { onNewFile, onNewFolder, container } = setup();
    const background = container.querySelector('[data-path=""]')!;
    fireEvent.contextMenu(background);
    fireEvent.click(await screen.findByRole("menuitem", { name: "New file…" }));
    expect(onNewFile).toHaveBeenCalledWith(root);
    fireEvent.contextMenu(background);
    expect(screen.queryByRole("menuitem", { name: "Rename…" })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: "New folder…" }));
    expect(onNewFolder).toHaveBeenCalledWith(root);
  });

  test("an empty folder says so", () => {
    render(
      <FileTree
        root={{ kind: "folder", name: "", path: "", children: [] }}
        expanded={new Set()}
        currentFile={undefined}
        onToggleFolder={() => {}}
        onOpenFile={() => {}}
        onNewFile={() => {}}
        onNewFolder={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("No Markdown files in this folder.")).toBeTruthy();
  });
});
