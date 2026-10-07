import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import type { DeletePreview, TreeNode } from "@specquer/shared/api";
import { CreateDialog, type CreateRequest, DeleteDialog, RenameDialog, splitExtension } from "./EntryDialogs";


const file: TreeNode = { kind: "file", name: "spec.md", path: "docs/spec.md" };
const folder: TreeNode = { kind: "folder", name: "docs", path: "docs", children: [] };

test("splitExtension keeps the extension fixed for files only", () => {
  expect(splitExtension(file)).toEqual({ stem: "spec", extension: ".md" });
  expect(splitExtension({ kind: "folder", name: "a.b" })).toEqual({ stem: "a.b", extension: "" });
});

describe("RenameDialog", () => {
  test("edits the name without the extension", async () => {
    const onRename = mock(async () => null);
    const onClose = mock(() => {});
    render(<RenameDialog node={file} onClose={onClose} onRename={onRename} />);
    const input = screen.getByRole("textbox", { name: "New name" }) as HTMLInputElement;
    expect(input.value).toBe("spec");
    expect(screen.getByText(".md")).toBeTruthy();
    fireEvent.change(input, { target: { value: "renamed" } });
    (screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).click();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onRename).toHaveBeenCalledWith(file, "renamed.md");
  });

  test("invalid names show an error and aren't sent", async () => {
    const onRename = mock(async () => null);
    render(<RenameDialog node={folder} onClose={() => {}} onRename={onRename} />);
    const input = screen.getByRole("textbox", { name: "New name" });
    fireEvent.change(input, { target: { value: "a/b" } });
    (screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).click();
    expect((await screen.findByRole("alert")).textContent).toContain("/");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "" } });
    (screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).click();
    expect((await screen.findByRole("alert")).textContent).toContain("empty");
    expect(onRename).not.toHaveBeenCalled();
  });

  test("a name collision keeps the dialog open with the server's message", async () => {
    const onClose = mock(() => {});
    render(<RenameDialog node={file} onClose={onClose} onRename={async () => "A file or folder with that name already exists."} />);
    fireEvent.change(screen.getByRole("textbox", { name: "New name" }), { target: { value: "taken" } });
    (screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).click();
    expect((await screen.findByRole("alert")).textContent).toBe("A file or folder with that name already exists.");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Cancel closes without renaming", () => {
    const onClose = mock(() => {});
    const onRename = mock(async () => null);
    render(<RenameDialog node={file} onClose={onClose} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe("CreateDialog", () => {
  const newFile: CreateRequest = { parent: { ...folder, kind: "folder", children: [] }, kind: "file" };
  const newFolder: CreateRequest = { ...newFile, kind: "folder" };

  test("a new file's name starts empty and gets the .md extension", async () => {
    const onCreate = mock(async () => null);
    const onClose = mock(() => {});
    render(<CreateDialog request={newFile} onClose={onClose} onCreate={onCreate} />);
    expect(screen.getByRole("dialog", { name: "New file" })).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "New name" }) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.getByText(".md")).toBeTruthy();
    fireEvent.change(input, { target: { value: "spec" } });
    (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).click();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCreate).toHaveBeenCalledWith(newFile, "spec.md");
  });

  test("names the root folder as such", () => {
    render(<CreateDialog request={{ ...newFile, parent: { ...folder, kind: "folder", name: "", path: "" } }} onClose={() => {}} onCreate={async () => null} />);
    expect(screen.getByText("Enter a name for the new file in the root folder.")).toBeTruthy();
  });

  test("a new folder's name has no extension", async () => {
    const onCreate = mock(async () => null);
    render(<CreateDialog request={newFolder} onClose={() => {}} onCreate={onCreate} />);
    expect(screen.getByRole("dialog", { name: "New folder" })).toBeTruthy();
    expect(screen.queryByText(".md")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "New name" }), { target: { value: "notes" } });
    (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).click();
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(newFolder, "notes"));
  });

  test("an empty or invalid name isn't sent", async () => {
    const onCreate = mock(async () => null);
    render(<CreateDialog request={newFile} onClose={() => {}} onCreate={onCreate} />);
    (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).click();
    expect((await screen.findByRole("alert")).textContent).toContain("empty");
    fireEvent.change(screen.getByRole("textbox", { name: "New name" }), { target: { value: "a/b" } });
    (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).click();
    expect((await screen.findByRole("alert")).textContent).toContain("/");
    expect(onCreate).not.toHaveBeenCalled();
  });

  test("a name collision keeps the dialog open with the server's message", async () => {
    const onClose = mock(() => {});
    render(<CreateDialog request={newFolder} onClose={onClose} onCreate={async () => "A file or folder with that name already exists."} />);
    fireEvent.change(screen.getByRole("textbox", { name: "New name" }), { target: { value: "taken" } });
    (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).click();
    expect((await screen.findByRole("alert")).textContent).toBe("A file or folder with that name already exists.");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("DeleteDialog", () => {
  const preview: DeletePreview = {
    path: "docs",
    kind: "folder",
    files: ["docs/a.md", "docs/image.png"],
    fileCount: 2,
    uncommitted: ["docs/image.png"],
  };

  test("lists everything that will be deleted and warns about uncommitted files", async () => {
    render(<DeleteDialog node={folder} onClose={() => {}} loadPreview={async () => preview} onDelete={async () => null} />);
    const list = await screen.findByRole("list", { name: "Files to delete" });
    expect(list.textContent).toContain("docs/image.png");
    expect(screen.getByText(/including 1 not shown in the tree/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("1 file isn't committed");
  });

  test("warns when the folder isn't in Git", async () => {
    render(
      <DeleteDialog node={folder} onClose={() => {}} loadPreview={async () => ({ ...preview, uncommitted: null })} onDelete={async () => null} />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("isn't in a Git repository");
  });

  test("Delete deletes and closes", async () => {
    const onDelete = mock(async () => null);
    const onClose = mock(() => {});
    render(<DeleteDialog node={file} onClose={onClose} loadPreview={async () => ({ ...preview, kind: "file", uncommitted: [] })} onDelete={onDelete} />);
    const button = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDelete).toHaveBeenCalledWith(file);
  });
});
