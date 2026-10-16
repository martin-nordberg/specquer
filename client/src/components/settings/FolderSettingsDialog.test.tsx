import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import type { FolderSettings, TreeFolder } from "@specquer/shared/api";
import type { FolderSaveOutcome } from "@/lib/api";
import { FolderSettingsDialog } from "./FolderSettingsDialog";

const folder: TreeFolder = { kind: "folder", name: "archive", path: "docs/archive", children: [] };

const INHERITING: FolderSettings = {
  path: "docs/archive",
  version: "v1",
  own: { folderType: "inherit", defaultPrefix: "inherit" },
  inherited: { folderType: { value: "BASELINE", from: "docs" }, defaultPrefix: { value: "REQ", from: "docs" } },
};

function setup(settings: FolderSettings = INHERITING, outcome: FolderSaveOutcome = { kind: "saved", version: "v2", sectioned: true }) {
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
const prefixBox = () => within(dialog()).queryByRole("textbox", { name: "Default prefix" }) as HTMLInputElement | null;

describe("FolderSettingsDialog", () => {
  test("shows the folder's file, what it inherits and the four types", async () => {
    setup();
    await waitFor(() => expect(radio(/^Inherited/).getAttribute("aria-checked")).toBe("true"));
    expect(dialog().textContent).toContain("docs/archive/.specquer-config.yaml");
    expect(radio(/^Inherited/).closest("label")?.textContent).toContain("Inherited: from docs: Baseline");
    for (const name of [/^Baseline/, /^Change/, /^Auxiliary/, /^Non-sectioned/]) expect(radio(name)).toBeTruthy();
    expect(prefixBox()?.value).toBe("REQ");
    expect(dialog().textContent).toContain("Inherited from docs: REQ");
    expect(button("Save").disabled).toBe(true);
    // Add section anchors is in the folder's menu now (Step 015)
    expect(within(dialog()).queryByRole("button", { name: "Add section anchors…" })).toBeNull();
  });

  test("saves only the values that differ from the inherited ones, and checks the prefix", async () => {
    const { api } = setup();
    await waitFor(() => expect(radio(/^Change/)).toBeTruthy());
    fireEvent.click(radio(/^Change/));
    fireEvent.change(prefixBox()!, { target: { value: "toolong" } });
    expect(prefixBox()!.value).toBe("TOOLONG");
    expect(prefixBox()!.getAttribute("aria-invalid")).toBe("true");
    expect(button("Save").disabled).toBe(true);
    fireEvent.change(prefixBox()!, { target: { value: "work" } });
    fireEvent.click(button("Save"));
    await waitFor(() => expect(api.saveFolderSettings).toHaveBeenCalledWith("docs/archive", { folderType: "CHANGE", defaultPrefix: "WORK" }, "v1"));
  });

  test("the prefix field shows only for sectioned types; the inherited prefix saves as inherited", async () => {
    const { api } = setup();
    await waitFor(() => expect(radio(/^Auxiliary/)).toBeTruthy());
    fireEvent.click(radio(/^Non-sectioned/));
    expect(prefixBox()).toBeNull();
    fireEvent.click(radio(/^Auxiliary/));
    expect(prefixBox()!.value).toBe("REQ");
    fireEvent.click(button("Save"));
    await waitFor(() => expect(api.saveFolderSettings).toHaveBeenCalledWith("docs/archive", { folderType: "AUXILIARY", defaultPrefix: "inherit" }, "v1"));
  });

  test("a sectioned type with no prefix anywhere needs one", async () => {
    setup({ ...INHERITING, inherited: { folderType: { value: null, from: null }, defaultPrefix: { value: null, from: null } } });
    await waitFor(() => expect(radio(/^Baseline/)).toBeTruthy());
    expect(radio(/^Inherited/).closest("label")?.textContent).toContain("non-sectioned (no folder above sets a type)");
    fireEvent.click(radio(/^Baseline/));
    expect(prefixBox()!.getAttribute("aria-invalid")).toBe("true");
    expect(button("Save").disabled).toBe(true);
  });

  test("turning a folder off says the anchors stay", async () => {
    const { api, onClose } = setup(INHERITING, { kind: "saved", version: "v2", sectioned: false });
    await waitFor(() => expect(radio(/^Non-sectioned/)).toBeTruthy());
    fireEvent.click(radio(/^Non-sectioned/));
    fireEvent.click(button("Save"));
    await waitFor(() => expect(within(dialog()).getByRole("status").textContent).toContain("The anchors stay in its files"));
    expect(api.saveFolderSettings).toHaveBeenCalledWith("docs/archive", { folderType: "NONSECTIONED", defaultPrefix: "inherit" }, "v1");
    // The footer's Close, before the dialog's own close button
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Close" })[0]!);
    expect(onClose).toHaveBeenCalled();
  });

  test("a folder that becomes sectioned is offered Add section anchors", async () => {
    const off: FolderSettings = { ...INHERITING, own: { folderType: "NONSECTIONED", defaultPrefix: "inherit" } };
    const { onAddAnchors, onClose } = setup(off);
    await waitFor(() => expect(radio(/^Non-sectioned/).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(radio(/^Inherited/));
    fireEvent.click(button("Save"));
    await waitFor(() => expect(within(dialog()).getByRole("status").textContent).toContain("The folder is sectioned now"));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add section anchors…" }));
    expect(onClose).toHaveBeenCalled();
    expect(onAddAnchors).toHaveBeenCalledWith(folder);
  });

  test("a conflict reloads the settings and says so", async () => {
    const { api } = setup(INHERITING, { kind: "conflict" });
    await waitFor(() => expect(radio(/^Non-sectioned/)).toBeTruthy());
    fireEvent.click(radio(/^Non-sectioned/));
    fireEvent.click(button("Save"));
    await waitFor(() => expect(within(dialog()).getByRole("alert").textContent).toContain("changed on disk"));
    expect(api.folderSettings).toHaveBeenCalledTimes(2);
    expect(radio(/^Inherited/).getAttribute("aria-checked")).toBe("true");
  });
});
