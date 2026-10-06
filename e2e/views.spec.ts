/// <reference lib="dom" />
import { contentEditor, expect, hideTab, launch, openFile, saveStatus, test, typeAtEnd } from "./fixtures";

test.beforeEach(async ({ page, specquer }) => {
  await launch(page, specquer);
});

function view(page: import("@playwright/test").Page, name: string) {
  return page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name });
}

test("the preview renders sanitized Markdown and links between documents", async ({ page }) => {
  await openFile(page, "docs", "a.md");
  await view(page, "Preview").click();
  const preview = page.getByTestId("preview");
  await expect(preview.getByRole("heading", { name: "Alpha" })).toBeVisible();
  // Parsing runs in the Web Worker, not on the main thread
  expect(page.workers().map((w) => new URL(w.url()).pathname)).toContain("/_specquer/preview-worker.js");
  await expect(preview.locator('a[name="user-content-r7k2"]')).toHaveAttribute("data-status", "draft");
  await expect(preview.getByRole("link", { name: "the anchor" })).toHaveAttribute("href", "#user-content-r7k2");
  await expect(preview.locator("img")).not.toHaveAttribute("onerror", /.*/);
  expect(await page.evaluate(() => (window as { __xss?: boolean }).__xss)).toBeUndefined();
  await preview.getByRole("link", { name: "beta" }).click();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("b.md");
});

test("the split view's preview follows the text", async ({ page }) => {
  await openFile(page, "b.md");
  await view(page, "Split").click();
  await typeAtEnd(contentEditor(page), "\n\n## Fresh heading");
  await expect(page.getByTestId("preview").getByRole("heading", { name: "Fresh heading" })).toBeVisible();
});

test("the view type is remembered per file, also after a reload", async ({ page }) => {
  await openFile(page, "docs", "a.md");
  await view(page, "Preview").click();
  await openFile(page, "b.md");
  await expect(view(page, "Text")).toHaveAttribute("aria-checked", "true");
  await openFile(page, "a.md");
  await expect(view(page, "Preview")).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("a.md");
  await expect(view(page, "Preview")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("treeitem", { name: "docs" })).toHaveAttribute("aria-expanded", "true");
});

test("switching views keeps unsaved text", async ({ page }) => {
  await openFile(page, "b.md");
  await typeAtEnd(contentEditor(page), "\nkept");
  await view(page, "Preview").click();
  await expect(page.getByTestId("preview")).toContainText("kept");
  await view(page, "Text").click();
  await expect(contentEditor(page)).toContainText("kept");
});

test("WYSIWYG doesn't change a file that isn't edited", async ({ page, specquer }) => {
  await openFile(page, "docs", "a.md");
  await view(page, "WYSIWYG").click();
  await expect(page.getByRole("textbox", { name: "Markdown content (WYSIWYG)" })).toContainText("Alpha");
  await hideTab(page);
  await openFile(page, "b.md");
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("docs/a.md")).toBe(
    '---\ntitle: Alpha\n---\n# Alpha <a name="r7k2" data-status="draft"></a>\n\nSee [beta](../b.md) and [the anchor](#r7k2).\n\n<img src="x.png" onerror="window.__xss = true">\n',
  );
});

test("WYSIWYG edits are saved", async ({ page, specquer }) => {
  await openFile(page, "b.md");
  await view(page, "WYSIWYG").click();
  const editor = page.getByRole("textbox", { name: "Markdown content (WYSIWYG)" });
  await editor.getByText("Body of beta.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More words.");
  await expect(saveStatus(page)).toHaveText("Unsaved changes");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("b.md")).toContain("Body of beta. More words.");
});
