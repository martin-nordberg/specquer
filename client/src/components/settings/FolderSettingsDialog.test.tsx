import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import type { FolderSettings, TreeFolder } from "@specquer/shared/api";
import type { FolderSaveOutcome } from "@/lib/api";
import { FolderSettingsDialog } from "./FolderSettingsDialog";

const folder: TreeFolder = { kind: "folder", name: "archive", path: "docs/archive", children: [] };

const INHERITING: FolderSettings = {
  path: "docs/archive",
  version: "v1",
  own: { kind: "inherit" },
  inherited: { from: "docs", prefix: "REQ" },
  fileKeys: [{ path: "docs/archive/keep.md", prefix: "KEEP" }],
};

function setup(settings: FolderSettings = INHERITING, outcome: FolderSaveOutcome = { kind: "saved", version: "v2", sectioned: false }) {
  const api = {
    folderSettings: mock(async () => settings),
    saveFolderSettings: mock(async () => outcome),
  };
  const onClose = mock(() => {});
  const onAddAnchors = mock(() => {});
  render(<FolderSettingsDialog folder={folder} onClose={onClose} api={api} onAddAnchors={onAddAnchors} />);
  return { api, onClose, onAddAnchors };
}

const dialog = () => screen.getByRole("dialog", { name: "Folder settings" });
const radio = (name: RegExp) => within(dialog()).getByRole("radio", { name });
const button = (name: string) => within(dialog()).getByRole("button", { name }) as HTMLButtonElement;

describe("FolderSettingsDialog", () => {
  test("shows what the folder inherits and the file keys inside it", async () => {
    setup();
    await waitFor(() => expect(radio(/^Inherited/).getAttribute("aria-checked")).toBe("true"));
    expect(radio(/^Inherited/).closest("label")?.textContent).toContain("Inherited: from docs: sectioned, prefix REQ");
    expect(within(dialog()).getByRole("list", { name: "Files with their own settings" }).textContent).toBe("docs/archive/keep.md: KEEP");
    expect(within(dialog()).queryByRole("textbox", { name: "Prefix" })).toBeNull();
    expect(button("Save").disabled).toBe(true);
    expect(button("Add section anchors…").disabled).toBe(false);
  });

  test("the prefix shows only for Yes, and is checked", async () => {
    const { api } = setup(INHERITING, { kind: "saved", version: "v2", sectioned: true });
    await waitFor(() => expect(radio(/^Yes/)).toBeTruthy());
    fireEvent.click(radio(/^Yes/));
    const input = within(dialog()).getByRole("textbox", { name: "Prefix" }) as HTMLInputElement;
    expect(input.value).toBe("REQ");
    fireEvent.change(input, { target: { value: "toolong" } });
    expect(input.value).toBe("TOOLONG");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(button("Save").disabled).toBe(true);
    fireEvent.change(input, { target: { value: "arc" } });
    fireEvent.click(button("Save"));
    await waitFor(() => expect(api.saveFolderSettings).toHaveBeenCalledWith("docs/archive", { kind: "prefix", prefix: "ARC" }, "v1"));
  });

  test("turning a folder off says the anchors stay", async () => {
    const { api, onClose } = setup();
    await waitFor(() => expect(radio(/^No/)).toBeTruthy());
    fireEvent.click(radio(/^No/));
    fireEvent.click(button("Save"));
    await waitFor(() => expect(within(dialog()).getByRole("status").textContent).toContain("The anchors stay in its files"));
    expect(api.saveFolderSettings).toHaveBeenCalledWith("docs/archive", { kind: "off" }, "v1");
    // The footer's Close, before the dialog's own close button
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Close" })[0]!);
    expect(onClose).toHaveBeenCalled();
  });

  test("a folder that becomes sectioned is offered Add section anchors", async () => {
    const off: FolderSettings = { ...INHERITING, own: { kind: "off" }, fileKeys: [] };
    const { onAddAnchors, onClose } = setup(off, { kind: "saved", version: "v2", sectioned: true });
    await waitFor(() => expect(radio(/^No/).getAttribute("aria-checked")).toBe("true"));
    expect(button("Add section anchors…").disabled).toBe(true);
    fireEvent.click(radio(/^Inherited/));
    fireEvent.click(button("Save"));
    await waitFor(() => expect(within(dialog()).getByRole("status").textContent).toContain("The folder is sectioned now"));
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Add section anchors…" }).at(-1)!);
    expect(onClose).toHaveBeenCalled();
    expect(onAddAnchors).toHaveBeenCalledWith(folder);
  });

  test("a conflict reloads the settings and says so", async () => {
    const { api } = setup(INHERITING, { kind: "conflict" });
    await waitFor(() => expect(radio(/^No/)).toBeTruthy());
    fireEvent.click(radio(/^No/));
    fireEvent.click(button("Save"));
    await waitFor(() => expect(within(dialog()).getByRole("alert").textContent).toContain("changed on disk"));
    expect(api.folderSettings).toHaveBeenCalledTimes(2);
    expect(radio(/^Inherited/).getAttribute("aria-checked")).toBe("true");
  });
});
