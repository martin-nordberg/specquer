import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("FileTree in All Files (Step 014)", () => {
  const all: TreeFolder = {
    kind: "folder",
    name: "",
    path: "",
    children: [
      {
        kind: "folder",
        name: ".specquer",
        path: ".specquer",
        children: [{ kind: "folder", name: "shared", path: ".specquer/shared", children: [{ kind: "file", name: "agent.config.yaml", path: ".specquer/shared/agent.config.yaml" }] }],
      },
      { kind: "folder", name: "src", path: "src", children: [{ kind: "file", name: "index.ts", path: "src/index.ts" }] },
      { kind: "file", name: "a.md", path: "a.md" },
      { kind: "file", name: "logo.png", path: "logo.png" },
      { kind: "file", name: "manual.pdf", path: "manual.pdf" },
    ],
  };
  const handlers = () => ({
    onToggleFolder: mock(() => {}),
    onOpenFile: mock(() => {}),
    onNewFile: mock(() => {}),
    onNewFolder: mock(() => {}),
    onRename: mock(() => {}),
    onDelete: mock(() => {}),
  });

  test("each kind of file has its icon", () => {
    render(<FileTree root={all} expanded={new Set(["src"])} currentFile={undefined} {...handlers()} />);
    const icon = (name: string) => screen.getByRole("treeitem", { name }).querySelector("svg:nth-of-type(1)")!.getAttribute("class");
    expect(icon("a.md")).toContain("lucide-file-text");
    expect(icon("index.ts")).toContain("lucide-file-code");
    expect(icon("logo.png")).toContain("lucide-file-image");
    expect(icon("manual.pdf")).toMatch(/lucide-file(?!-)/);
  });

  test("every folder and every file has the same menu, Markdown or not, .specquer included (Step 015)", async () => {
    const props = { ...handlers(), onFolderSettings: mock(() => {}), onAddAnchors: mock(() => {}), onShowProblems: mock(() => {}) };
    const tree: TreeFolder = { ...all, children: [...all.children, { kind: "folder", name: "empty", path: "empty", children: [] }] };
    render(<FileTree root={tree} expanded={new Set(["src", ".specquer", ".specquer/shared"])} currentFile={undefined} {...props} />);
    const menu = async (name: string) => {
      fireEvent.contextMenu(screen.getByText(name));
      const items = await screen.findAllByRole("menuitem");
      const shown = items.map((item) => item.textContent?.trim());
      // Separators sit between the groups
      const separators = document.querySelectorAll('[role="separator"]').length;
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryAllByRole("menuitem")).toHaveLength(0));
      return { shown, separators };
    };
    const folderMenu = { shown: ["New file…", "New folder…", "Rename…", "Delete…", "Add section anchors…", "Settings…", "Section problems…"], separators: 2 };
    const fileMenu = { shown: ["Rename…", "Delete…", "Add section anchors…", "Section problems…"], separators: 1 };
    for (const name of ["src", "empty", ".specquer", "shared"]) expect([name, await menu(name)]).toEqual([name, folderMenu]);
    for (const name of ["a.md", "index.ts", "logo.png", "agent.config.yaml"]) expect([name, await menu(name)]).toEqual([name, fileMenu]);
    fireEvent.contextMenu(screen.getByText("index.ts"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add section anchors…" }));
    expect(props.onAddAnchors).toHaveBeenCalledWith({ kind: "file", name: "index.ts", path: "src/index.ts" });
    fireEvent.contextMenu(screen.getByText("src"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Section problems…" }));
    expect((props.onShowProblems.mock.calls[0] as unknown[])[0]).toMatchObject({ kind: "folder", path: "src" });
  });

  test("an empty tree says what the view shows", () => {
    render(<FileTree root={{ kind: "folder", name: "", path: "", children: [] }} emptyMessage="No files in this folder." expanded={new Set()} currentFile={undefined} {...handlers()} />);
    expect(screen.getByText("No files in this folder.")).toBeTruthy();
  });
});
