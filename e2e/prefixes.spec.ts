/// <reference lib="dom" />
import { contentEditor, expect, hideTab, launch, openFile, saveStatus, test, treeItem } from "./fixtures";

const anchor = (id: string, uid: string) => `<a id="${id}" data-uid="${uid}"></a>`;
const SPEC = `${anchor("SPEC-00001", "docaaaaaaaa1")}\n\n${anchor("SPEC-00002", "secbbbbbbbb2")}\n# Spec\n\nText.\n`;

test.use({
  files: {
    "specs/.specquer-config.yaml": "folderType: BASELINE\ndefaultPrefix: SPEC\n",
    "specs/spec.md": SPEC,
  },
});

test.beforeEach(async ({ page, specquer }) => {
  await launch(page, specquer);
});

test("a new file can start with another prefix", async ({ page, specquer }) => {
  await treeItem(page, "specs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New file…" }).click();
  const dialog = page.getByRole("dialog", { name: "New file" });
  const prefix = dialog.getByRole("textbox", { name: "Prefix" });
  await expect(prefix).toHaveValue("SPEC");
  await dialog.getByRole("textbox", { name: "New name" }).fill("glossary");
  await prefix.fill("defn");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  expect(await specquer.read("specs/glossary.md")).toMatch(/^<a id="DEFN-00001" data-uid="[a-z0-9]+"><\/a>\n\n$/);
});

test("XYZ-? typed over a section's ID gives it another prefix and keeps its UID", async ({ page, specquer }) => {
  await openFile(page, "specs", "spec.md");
  const editor = contentEditor(page);
  await expect(editor).toContainText('<a id="SPEC-00002"');
  // Select the ID on the heading's anchor line (the third) and type over it
  await editor.click();
  await editor.press("ControlOrMeta+Home");
  for (let line = 0; line < 2; line++) await editor.press("ArrowDown");
  await editor.press("Home");
  for (let i = 0; i < '<a id="'.length; i++) await editor.press("ArrowRight");
  for (let i = 0; i < "SPEC-00002".length; i++) await editor.press("Shift+ArrowRight");
  await editor.pressSequentially("XYZ-?");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  await expect(editor).toContainText('<a id="XYZ-00001" data-uid="secbbbbbbbb2">');
  await expect(page.getByText("SPEC-00002 in “Spec” is now XYZ-00001, as requested.")).toBeVisible();
  expect(await specquer.read("specs/spec.md")).toBe(SPEC.replace("SPEC-00002", "XYZ-00001"));
  expect(await specquer.read(".specquer/shared/XYZ/sections.yaml")).toContain("secbbbbbbbb2: { id: XYZ-00001");
});
