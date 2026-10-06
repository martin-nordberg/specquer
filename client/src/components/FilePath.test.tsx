import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import { FilePath, elidePath } from "./FilePath";


describe("elidePath", () => {
  test("shows the whole path when nothing is hidden", () => {
    expect(elidePath("a/b/c.md", 0)).toEqual([
      { kind: "folder", name: "a" },
      { kind: "folder", name: "b" },
      { kind: "file", name: "c.md" },
    ]);
  });

  test("replaces leading folders with one ellipsis", () => {
    expect(elidePath("a/b/c/d.md", 2)).toEqual([
      { kind: "ellipsis", hidden: ["a", "b"] },
      { kind: "folder", name: "c" },
      { kind: "file", name: "d.md" },
    ]);
  });

  test("never hides the file name", () => {
    expect(elidePath("a/b.md", 5)).toEqual([
      { kind: "ellipsis", hidden: ["a"] },
      { kind: "file", name: "b.md" },
    ]);
    expect(elidePath("top.md", 3)).toEqual([{ kind: "file", name: "top.md" }]);
  });
});

describe("FilePath", () => {
  test("shows the path from the root as a breadcrumb", () => {
    render(<FilePath path="docs/specs/a.md" recentFiles={[]} onOpenFile={() => {}} />);
    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(nav.textContent).toBe("docsspecsa.md");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("with recent files, the file name opens a list of them", async () => {
    const onOpenFile = mock(() => {});
    render(<FilePath path="a.md" recentFiles={["b.md", "docs/c.md"]} onOpenFile={onOpenFile} />);
    const trigger = screen.getByRole("button", { name: "a.md, recent files" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "docs/c.md" }));
    expect(onOpenFile).toHaveBeenCalledWith("docs/c.md");
  });
});
