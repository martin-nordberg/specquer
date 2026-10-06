import { expect, launch, openFile, test, treeItem } from "./fixtures";

test.beforeEach(async ({ page, specquer }) => {
  await launch(page, specquer);
});

test("renaming a file keeps its extension and rejects taken names", async ({ page, specquer }) => {
  await openFile(page, "docs", "a.md");
  await treeItem(page, "a.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename file" });
  const input = dialog.getByRole("textbox", { name: "New name" });
  await expect(input).toHaveValue("a");
  await expect(dialog).toContainText(".md");

  await input.fill("bad/name");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog.getByRole("alert")).toContainText("/");

  await input.fill("alpha");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toBeHidden();
  await expect(treeItem(page, "alpha.md")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("alpha.md");
  expect(await specquer.exists("docs/alpha.md")).toBe(true);
  expect(await specquer.exists("docs/a.md")).toBe(false);
});

test("a name collision keeps the dialog open with an error", async ({ page, specquer }) => {
  await specquer.write("docs/taken.md", "");
  await page.reload();
  await openFile(page, "docs", "a.md");
  await treeItem(page, "a.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename file" });
  await dialog.getByRole("textbox", { name: "New name" }).fill("taken");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("A file or folder with that name already exists.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("renaming a folder moves the open file with it", async ({ page, specquer }) => {
  await openFile(page, "docs", "deep", "c.md");
  await treeItem(page, "docs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename folder" });
  await dialog.getByRole("textbox", { name: "New name" }).fill("specs");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(treeItem(page, "specs")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "specs" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("specs");
  expect(await specquer.read("specs/deep/c.md")).toBe("# Gamma\n");
});

test("deleting a folder lists hidden files first", async ({ page, specquer }) => {
  await treeItem(page, "docs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete folder" });
  const files = dialog.getByRole("list", { name: "Files to delete" });
  await expect(files).toContainText("docs/notes.txt");
  await expect(files).toContainText("docs/deep/c.md");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden();
  await expect(treeItem(page, "docs")).toHaveCount(0);
  expect(await specquer.exists("docs/a.md")).toBe(false);
  expect(await specquer.exists("b.md")).toBe(true);
});

test("deleting the open file closes it and warns about uncommitted changes", async ({ page, specquer }) => {
  await specquer.write("b.md", "changed\n");
  await openFile(page, "b.md");
  await treeItem(page, "b.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete file" });
  await expect(dialog.getByRole("alert")).toContainText("isn't committed");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Select a file in the folder pane.")).toBeVisible();
  expect(await specquer.exists("b.md")).toBe(false);
});

test("recent files are offered from the file name", async ({ page }) => {
  await openFile(page, "docs", "a.md");
  await openFile(page, "b.md");
  await page.getByRole("button", { name: "b.md, recent files" }).click();
  await page.getByRole("menuitem", { name: "docs/a.md" }).click();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("a.md");
});

test("the theme can be switched and is remembered", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
