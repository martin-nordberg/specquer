/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { type FakeModel, fakeModelConfig, startFakeModel } from "./fake-model";
import { contentEditor, test as base, expect, launch, openFile, saveStatus, typeAtEnd } from "./fixtures";

const words = (n: number, word: string) => Array(n).fill(word).join(" ");

const SPEC = [
  "Intro before the headings.",
  "",
  "# Spec",
  "",
  "Lead of the spec.",
  "",
  "## Alpha",
  "",
  words(80, "alpha"),
  "",
  "## Beta",
  "",
  words(70, "beta"),
  "",
  '<a id="REQ-00007"></a>',
  "### Beta detail",
  "",
  words(70, "detail"),
  "",
].join("\n");

/** Specquer with a fake model configured. */
const test = base.extend<{ model: FakeModel }>({
  model: async ({}, use) => {
    const model = startFakeModel();
    await use(model);
    await model.stop();
  },
  files: async ({ model }, use) => {
    await use({
      "docs/spec.md": SPEC,
      "docs/links.md": "# Links\n\nSee [the detail](spec.md#REQ-00007).\n",
      ".specquer/shared/agent.config.yaml": fakeModelConfig(model),
    });
  },
});

test.beforeEach(async ({ page, specquer }) => {
  await launch(page, specquer);
});

function view(page: Page, name: string) {
  return page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name });
}

const slider = (page: Page) => page.getByRole("slider", { name: "Summary level" });

async function openPreview(page: Page, ...names: string[]) {
  await openFile(page, ...names);
  await view(page, "Preview").click();
}

async function moveSlider(page: Page, key: "ArrowLeft" | "ArrowRight", times = 1) {
  await slider(page).focus();
  for (let i = 0; i < times; i++) await slider(page).press(key);
}

test("the slider moves through every stop", async ({ page }) => {
  await openPreview(page, "docs", "spec.md");
  const preview = page.getByTestId("preview");
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Full text");
  await expect(preview.getByRole("heading")).toHaveCount(4);

  await moveSlider(page, "ArrowLeft");
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Summarize level 3 sections");
  await expect(preview.getByText("Summary of Beta detail.")).toBeVisible();
  await expect(preview.getByRole("heading")).toHaveCount(4);

  await moveSlider(page, "ArrowLeft");
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Summarize level 2 sections");
  await expect(preview.getByText("Summary of Alpha.")).toBeVisible();
  await expect(preview.getByText("Summary of Beta.")).toBeVisible();
  await expect(preview.getByRole("heading")).toHaveCount(3);
  await expect(preview.getByText("Lead of the spec.")).toBeVisible();

  await moveSlider(page, "ArrowLeft");
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Summarize level 1 sections");
  await expect(preview.getByText("Summary of Spec.")).toBeVisible();
  await expect(preview.getByRole("heading")).toHaveCount(1);
  await expect(preview.getByText("Intro before the headings.")).toBeVisible();

  await moveSlider(page, "ArrowLeft");
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Summarize document");
  await expect(preview.getByText("Summary of Intro before the headings..")).toBeVisible();
  await expect(preview.getByRole("heading")).toHaveCount(0);

  await moveSlider(page, "ArrowRight", 4);
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Full text");
  await expect(preview.getByText(/alpha alpha/)).toBeVisible();
  await expect(preview.getByTestId("section-summary")).toHaveCount(0);
});

test("the position is kept after a reload, and summaries come from the cache", async ({ page, specquer, model }) => {
  await openPreview(page, "docs", "spec.md");
  await moveSlider(page, "ArrowLeft", 2);
  await expect(page.getByText("Summary of Alpha.")).toBeVisible();
  const calls = model.prompts.length;
  await page.waitForTimeout(500);
  await page.reload();
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Summarize level 2 sections");
  await expect(page.getByText("Summary of Alpha.")).toBeVisible();
  expect(model.prompts.length).toBe(calls);
  expect(await specquer.read(".specquer/user/uistate.yaml")).toContain("summaryStop: 2");
  expect(await specquer.read(".specquer/cache/.gitignore")).toBe("*\n");
});

test("Summarizing... then the summary, labeled as AI-generated", async ({ page, model }) => {
  model.delay = 1000;
  await openPreview(page, "docs", "spec.md");
  await moveSlider(page, "ArrowLeft", 2);
  await expect(page.getByText("Summarizing...").first()).toBeVisible();
  const summary = page.getByRole("region", { name: "AI summary" }).filter({ hasText: "Summary of Alpha." });
  await expect(summary).toBeVisible();
  await expect(summary.getByText("AI summary", { exact: true })).toBeVisible();
});

test("an error offers Retry", async ({ page, model }) => {
  model.failNext(Number.POSITIVE_INFINITY);
  await openPreview(page, "docs", "spec.md");
  await moveSlider(page, "ArrowLeft");
  await expect(page.getByText(/rate limit was reached/)).toBeVisible();
  model.failNext(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Summary of Beta detail.")).toBeVisible();
});

test("clicking a summary, or a link into a summarized section, shows the full text", async ({ page }) => {
  await openPreview(page, "docs", "spec.md");
  await moveSlider(page, "ArrowLeft", 2);
  await page.getByText("Summary of Alpha.").click();
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Full text");
  await expect(page.getByText(/alpha alpha/)).toBeVisible();

  await moveSlider(page, "ArrowLeft", 2);
  await expect(page.getByText("Summary of Beta.")).toBeVisible();
  await openPreview(page, "links.md");
  await page.getByRole("link", { name: "the detail" }).click();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("spec.md");
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Full text");
  await expect(page.locator("#user-content-REQ-00007")).toBeAttached();
  await expect(page.getByRole("heading", { name: /Beta detail/ })).toBeInViewport();
});

test("typing marks a summary out of date, and Save now brings it up to date", async ({ page, model }) => {
  await openFile(page, "docs", "spec.md");
  await view(page, "Split").click();
  await moveSlider(page, "ArrowLeft");
  const summary = page.getByRole("region", { name: "AI summary" });
  await expect(summary.getByText("Summary of Beta detail.")).toBeVisible();
  await typeAtEnd(contentEditor(page), " edited");
  await expect(summary.getByText("AI summary · out of date")).toBeVisible();
  // Unsaved text is never sent
  expect(model.prompts.some((prompt) => prompt.includes("edited"))).toBe(false);
  await saveStatus(page).getByRole("button", { name: "Unsaved changes: save now" }).click();
  await expect(saveStatus(page)).toHaveText("Saved");
  await expect(summary.getByText("AI summary", { exact: true })).toBeVisible();
  expect(model.prompts.some((prompt) => prompt.includes("edited"))).toBe(true);
});

base("without a model the slider is disabled with a hint", async ({ page }) => {
  await openFile(page, "b.md");
  await view(page, "Preview").click();
  await expect(slider(page)).toHaveAttribute("data-disabled", "");
  await expect(page.getByText(/Summaries need a model/)).toBeVisible();
});
