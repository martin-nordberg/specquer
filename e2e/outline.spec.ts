/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { type FakeModel, fakeModelApproval, fakeModelConfig, startFakeModel } from "./fake-model";
import { test as base, expect, launch, openFile } from "./fixtures";

/** Step 016: the Outline pane. */

const words = (n: number, word: string) => Array(n).fill(word).join(" ");
const anchor = (id: string, uid: string) => `<a id="${id}" data-uid="${uid}"></a>`;

// A sectioned document, long enough to scroll
const SECTIONED = [
  anchor("SPEC-00001", "docroot00001"),
  "",
  anchor("SPEC-00002", "uidguide0001"),
  "# Guide",
  "",
  words(60, "guide"),
  "",
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => [anchor(`SPEC-0001${n}`, `uidpart0000${n}`), `## Part ${n}`, "", words(150, `part${n}`), ""]),
  `- ${anchor("SPEC-00020", "uiditem00001")} The user can reset a password with a link`,
  "",
].join("\n");

// A document that isn't sectioned, for headings by outline path
const PLAIN = ["# Notes", "", words(40, "notes"), "", ...[1, 2, 3, 4, 5].flatMap((n) => [`## Topic ${n}`, "", words(150, `topic${n}`), ""])].join("\n");

const SUMMARIZED = ["# Spec", "", "Lead.", "", "## Alpha", "", words(80, "alpha"), "", "### Alpha detail", "", words(70, "detail"), "", "## Beta", "", words(70, "beta"), ""].join("\n");

const test = base.extend<{ model: FakeModel }>({
  model: async ({}, use) => {
    const model = startFakeModel();
    await use(model);
    await model.stop();
  },
  files: async ({ model }, use) => {
    await use({
      "specs/.specquer-config.yaml": "folderType: BASELINE\ndefaultPrefix: SPEC\n",
      "specs/guide.md": SECTIONED,
      "notes/plain.md": PLAIN,
      "notes/summarized.md": SUMMARIZED,
      "src/index.ts": "export const x = 1;\n",
      ".specquer/shared/agent.config.yaml": fakeModelConfig(model),
      ...fakeModelApproval(model),
    });
  },
});

test.beforeEach(async ({ page, specquer }) => {
  await launch(page, specquer);
});

const shots = process.env.SPECQUER_SCREENSHOTS;
const outline = (page: Page) => page.getByRole("tree", { name: "Outline" });
const item = (page: Page, name: string) => outline(page).getByRole("treeitem", { name, exact: true });
const view = (page: Page, name: string) => page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name });

async function openOutline(page: Page) {
  await page.getByRole("button", { name: "Outline" }).click();
  await expect(page.getByTestId("outline-pane")).toBeVisible();
}

test("the Outline toggles with the other panes, and stays open after a reload", async ({ page }) => {
  await page.getByRole("button", { name: "Comments" }).click();
  await openOutline(page);
  await expect(page.getByRole("button", { name: "Comments" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Outline" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("outline-pane")).toContainText("Open a document to see its outline.");
  await page.reload();
  await expect(page.getByTestId("outline-pane")).toBeVisible();
});

test("a sectioned document's sections, with their badges; collapsing is kept after a reload", async ({ page }) => {
  await openOutline(page);
  await openFile(page, "specs", "guide.md");
  await expect(item(page, "Guide")).toBeVisible();
  await expect(item(page, "Part 3")).toBeVisible();
  // A list item: its ID and first words, cut after eight
  await expect(item(page, "SPEC-00020 The user can reset a password with a …")).toBeVisible();
  await expect(item(page, "Guide").locator("img").first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/outline-sectioned.png` });
  // The icon collapses
  await item(page, "Guide").locator('[data-part="toggle"]').first().click();
  await expect(item(page, "Part 3")).toHaveCount(0);
  await expect(item(page, "Guide")).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(item(page, "Guide")).toHaveAttribute("aria-expanded", "false");
  // The keyboard expands
  await item(page, "Guide").focus();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "Part 3")).toBeVisible();
});

test("a click moves the preview to the section and highlights it; scrolling moves the highlight", async ({ page }) => {
  await openOutline(page);
  await openFile(page, "specs", "guide.md");
  if ((await view(page, "Preview").getAttribute("aria-checked")) !== "true") await view(page, "Preview").click();
  const preview = page.getByTestId("preview");
  await item(page, "Part 4").locator('[data-part="text"]').click();
  await expect(preview.getByRole("heading", { name: /Part 4/ })).toBeInViewport();
  await expect(item(page, "Part 4")).toHaveAttribute("aria-selected", "true");
  // Scrolling the preview back to the top, as a reader would after a moment, moves the highlight
  await page.waitForTimeout(400);
  await preview.locator("article").evaluate((element) => element.parentElement!.scrollTo({ top: 0 }));
  await expect(item(page, "Guide")).toHaveAttribute("aria-selected", "true");
  await expect(item(page, "Part 4")).toHaveAttribute("aria-selected", "false");
});

test("a document that isn't sectioned shows its headings, and moves the Text view to them", async ({ page }) => {
  await openOutline(page);
  await openFile(page, "notes", "plain.md");
  if ((await view(page, "Text").getAttribute("aria-checked")) !== "true") await view(page, "Text").click();
  await expect(item(page, "Topic 4")).toBeVisible();
  await expect(item(page, "Topic 4").locator("img")).toHaveCount(0);
  await item(page, "Topic 4").locator('[data-part="text"]').click();
  await expect(page.locator(".cm-line", { hasText: "## Topic 4" })).toBeInViewport();
  await expect(item(page, "Topic 4")).toHaveAttribute("aria-selected", "true");
});

test("the Outline follows the summary slider in the preview", async ({ page }) => {
  await openOutline(page);
  await openFile(page, "notes", "summarized.md");
  await view(page, "Preview").click();
  await expect(item(page, "Alpha detail")).toBeVisible();
  const slider = page.getByRole("slider", { name: "Summary level" });
  await slider.focus();
  await slider.press("ArrowLeft");
  await slider.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuetext", "Summarize level 2 sections");
  await expect(page.getByTestId("preview").getByText("Summary of Alpha.")).toBeVisible();
  await expect(item(page, "Alpha detail")).toHaveCount(0);
  await expect(item(page, "Alpha")).toContainText("summary");
  if (shots) await page.screenshot({ path: `${shots}/outline-summarized.png` });
  // The Text view shows the full text, and the Outline every section
  await view(page, "Text").click();
  await expect(item(page, "Alpha detail")).toBeVisible();
});

test("a file other than Markdown, and Add section anchors for a document outside a sectioned folder", async ({ page }) => {
  await openOutline(page);
  await page.getByRole("radiogroup", { name: "Files shown" }).getByRole("radio", { name: "All Files" }).click();
  await openFile(page, "src", "index.ts");
  await expect(page.getByTestId("outline-pane")).toContainText("(Not Markdown)");
  await openFile(page, "notes", "plain.md");
  await page.getByTestId("outline-pane").getByRole("button", { name: "Add section anchors…" }).click();
  await expect(page.getByRole("dialog", { name: "Add section anchors" })).toContainText("“plain.md” isn't in a sectioned folder");
});
