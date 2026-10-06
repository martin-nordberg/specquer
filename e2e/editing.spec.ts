import { contentEditor, expect, frontmatterEditor, hideTab, launch, openFile, saveStatus, test, treeItem, typeAtEnd } from "./fixtures";

test.beforeEach(async ({ page, specquer }) => {
  await launch(page, specquer);
});

test("tree navigation opens files with their front matter", async ({ page }) => {
  await expect(treeItem(page, "notes.txt")).toHaveCount(0);
  await openFile(page, "docs", "a.md");
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("docs");
  await expect(frontmatterEditor(page)).toHaveText("title: Alpha");
  await expect(contentEditor(page)).toContainText("# Alpha");
  // Folders collapse again
  await treeItem(page, "docs").click();
  await expect(treeItem(page, "a.md")).toHaveCount(0);
});

test("edits are saved before another file opens", async ({ page, specquer }) => {
  await openFile(page, "b.md");
  await typeAtEnd(contentEditor(page), "\nAdded line.");
  await expect(saveStatus(page)).toHaveText("Unsaved changes");
  await openFile(page, "docs", "a.md");
  expect(await specquer.read("b.md")).toBe("# Beta\n\nBody of beta.\n\nAdded line.");
});

test("edits are saved when the tab loses focus", async ({ page, specquer }) => {
  await openFile(page, "b.md");
  await typeAtEnd(contentEditor(page), "!");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("b.md")).toBe("# Beta\n\nBody of beta.\n!");
});

test("front matter can be added and removed", async ({ page, specquer }) => {
  await openFile(page, "b.md");
  await frontmatterEditor(page).click();
  await frontmatterEditor(page).pressSequentially("status: draft");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("b.md")).toBe("---\nstatus: draft\n---\n# Beta\n\nBody of beta.\n");

  await frontmatterEditor(page).click();
  await frontmatterEditor(page).press("ControlOrMeta+a");
  await frontmatterEditor(page).press("Delete");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("b.md")).toBe("# Beta\n\nBody of beta.\n");
});

test("invalid YAML is kept and marked with a warning", async ({ page, specquer }) => {
  await openFile(page, "docs", "a.md");
  await typeAtEnd(frontmatterEditor(page), "\ntags: [unclosed");
  await expect(page.getByText("Invalid YAML")).toBeVisible();
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect((await specquer.read("docs/a.md")).startsWith("---\ntitle: Alpha\ntags: [unclosed\n---\n")).toBe(true);
});

test("a file changed on disk isn't overwritten without asking", async ({ page, specquer }) => {
  await openFile(page, "b.md");
  await typeAtEnd(contentEditor(page), "mine");
  await specquer.write("b.md", "# Beta\n\nChanged by an agent.\n");
  await hideTab(page);
  const dialog = page.getByRole("dialog", { name: "The file changed on disk" });
  await expect(dialog).toBeVisible();
  expect(await specquer.read("b.md")).toBe("# Beta\n\nChanged by an agent.\n");
  await dialog.getByRole("button", { name: "Keep my version" }).click();
  await expect(dialog).toBeHidden();
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("b.md")).toBe("# Beta\n\nBody of beta.\nmine");
});

test("reloading from disk discards local changes", async ({ page, specquer }) => {
  await openFile(page, "b.md");
  await typeAtEnd(contentEditor(page), "mine");
  await specquer.write("b.md", "# Theirs\n");
  await hideTab(page);
  await page.getByRole("button", { name: "Reload from disk" }).click();
  await expect(contentEditor(page)).toHaveText("# Theirs");
  expect(await specquer.read("b.md")).toBe("# Theirs\n");
});
