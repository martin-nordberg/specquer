/// <reference lib="dom" />
import { expect, fixtureFiles, launch, openFile, test, treeItem } from "./fixtures";

/** Step 014: the All Files view, and files other than Markdown shown view-only. */

// A 1×1 PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
// Wider than the pane, so fitting scales it down
const WIDE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="300"><rect width="3000" height="300" fill="#2e79ba"/><circle cx="150" cy="150" r="100" fill="#f5b301"/></svg>\n';

test.use({
  files: {
    ...fixtureFiles,
    ".gitignore": "secret.env\n",
    "secret.env": "TOKEN=hidden\n",
    "src/index.ts": 'import { a } from "./a";\n\n/** The answer. */\nexport const answer: number = 42;\n',
    "img/wide.svg": WIDE_SVG,
  },
});

test.beforeEach(async ({ page, specquer }) => {
  await specquer.writeBytes("img/dot.png", PNG);
  await specquer.writeBytes("data.bin", new Uint8Array([0, 1, 2, 3, 255]));
  await launch(page, specquer);
});

function filesShown(page: import("@playwright/test").Page, name: string) {
  return page.getByRole("radiogroup", { name: "Files shown" }).getByRole("radio", { name });
}

const shots = process.env.SPECQUER_SCREENSHOTS;

test("All Files shows every file not ignored, and the choice is kept after a reload", async ({ page }) => {
  await expect(treeItem(page, "src")).toHaveCount(0);
  await filesShown(page, "All Files").click();
  await expect(treeItem(page, "src")).toBeVisible();
  await expect(treeItem(page, ".gitignore")).toBeVisible();
  await expect(treeItem(page, "data.bin")).toBeVisible();
  await expect(treeItem(page, "secret.env")).toHaveCount(0);
  await page.reload();
  await expect(filesShown(page, "All Files")).toHaveAttribute("aria-checked", "true");
  await expect(treeItem(page, "src")).toBeVisible();
  await filesShown(page, "Specs").click();
  await expect(treeItem(page, "src")).toHaveCount(0);
});

test("a TypeScript file is shown highlighted, with line numbers that aren't copied", async ({ page }) => {
  await filesShown(page, "All Files").click();
  await openFile(page, "src", "index.ts");
  const view = page.getByTestId("code-view");
  await expect(view.locator(".hljs-keyword", { hasText: "export" })).toBeVisible();
  await expect(view.locator(".code-gutter")).toHaveText("1\n2\n3\n4");
  await expect(page.getByRole("radiogroup", { name: "View" })).toHaveCount(0);
  if (shots) await page.screenshot({ path: `${shots}/text-file.png` });
  const copied = await view.evaluate((element) => {
    const selection = window.getSelection()!;
    selection.selectAllChildren(element.querySelector(".code-file")!);
    return selection.toString();
  });
  expect(copied).not.toMatch(/^1\n/);
  expect(copied).toContain("export const answer: number = 42;");
  // Not a file Specquer changes: no context menu
  await treeItem(page, "index.ts").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toHaveCount(0);
});

test("a file .gitignore hides can't be read either", async ({ page, specquer }) => {
  const response = await page.request.get(`${specquer.origin}/api/view?path=secret.env`);
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain("hidden");
});

test("images are shown, fitted to the pane, and at actual size on a click", async ({ page }) => {
  await filesShown(page, "All Files").click();
  await openFile(page, "img", "dot.png");
  await expect(page.getByTestId("image-details")).toHaveText(/^1 × 1 pixels · \d+ bytes$/);
  await openFile(page, "wide.svg");
  const image = page.getByRole("img", { name: "wide.svg" });
  await expect(page.getByTestId("image-details")).toHaveText(/^3000 × 300 pixels/);
  const fitted = await image.evaluate((element) => element.getBoundingClientRect().width);
  expect(fitted).toBeLessThan(3000);
  if (shots) await page.screenshot({ path: `${shots}/image-fit.png` });
  await page.getByRole("button", { name: "Show at actual size" }).click();
  await expect(page.getByRole("button", { name: "Fit to the pane" })).toHaveAttribute("aria-pressed", "true");
  expect(await image.evaluate((element) => element.getBoundingClientRect().width)).toBe(3000);
  // Enter switches back
  await page.getByRole("button", { name: "Fit to the pane" }).press("Enter");
  await expect(page.getByRole("button", { name: "Show at actual size" })).toBeVisible();
});

test("a binary file opens as a placeholder, and a document opens again after it", async ({ page }) => {
  await filesShown(page, "All Files").click();
  await openFile(page, "data.bin");
  await expect(page.getByTestId("file-placeholder")).toContainText("This file type cannot be displayed by Specquer.");
  await openFile(page, "b.md");
  await expect(page.getByRole("radiogroup", { name: "View" })).toBeVisible();
});
