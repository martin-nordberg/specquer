/// <reference lib="dom" />
import { contentEditor, expect, hideTab, launch, openFile, saveStatus, test, treeItem, typeAtEnd } from "./fixtures";

const DOC = "aaaaaaaaaaaaaaaaaaaaaaaa";
const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of filler text.`).join("\n\n");

test.use({
  files: {
    ".specquer/shared/section-prefixes.config.yaml": 'prefixes:\n  "specs/": SPEC\n',
    "specs/plain.md": "# Plain\n\nIntro text.\n",
    "specs/anchored.md": `<a id="SPEC-00001" data-document-id="${DOC}"></a>\n\n<a id="SPEC-00002"></a>\n# Anchored\n\n${filler}\n\n<a id="SPEC-00003"></a>\n## Details\n\n* <a id="SPEC-00004"></a> A listed requirement\n`,
    "specs/links.md": "# Links\n\nGo to [the details](anchored.md#SPEC-00003).\n",
    "notes/n.md": "# Not sectioned\n",
  },
});

test.beforeEach(async ({ page, specquer }) => {
  await launch(page, specquer);
});

function view(page: import("@playwright/test").Page, name: string) {
  return page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name });
}

test("saving adds anchors in place, keeps the cursor, and undo leaves them", async ({ page, specquer }) => {
  await openFile(page, "specs", "plain.md");
  const editor = contentEditor(page);
  await typeAtEnd(editor, "\n## Added");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  const saved = await specquer.read("specs/plain.md");
  expect(saved).toMatch(/^<a id="SPEC-00005" data-document-id="[a-z0-9]+"><\/a>\n\n<a id="SPEC-00006"><\/a>\n# Plain\n\nIntro text.\n\n<a id="SPEC-00007"><\/a>\n## Added$/);
  await expect(editor).toContainText('<a id="SPEC-00007"></a>');
  // The cursor stayed at the end of the text typed; typing after a pause is a separate undo step
  await page.waitForTimeout(600);
  await page.keyboard.type(" here");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toContainText('<a id="SPEC-00007"></a>');
  await page.keyboard.type(" again");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("specs/plain.md")).toMatch(/## Added again$/);
  expect(await specquer.read(".specquer/shared/SPEC/sections.yaml")).toContain("lastSequence: 7\n");
});

test("files outside the configuration are saved as typed", async ({ page, specquer }) => {
  await openFile(page, "notes", "n.md");
  await typeAtEnd(contentEditor(page), "\n## More");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("notes/n.md")).toBe("# Not sectioned\n\n## More");
});

test("the preview and split views show badges with a tooltip, and a click copies the ID", async ({ page, context, browserName }) => {
  await openFile(page, "specs", "anchored.md");
  await view(page, "Preview").click();
  const preview = page.getByTestId("preview");
  await expect(preview.getByRole("button", { name: /^Section SPEC-/ })).toHaveCount(4);
  const badge = preview.getByRole("button", { name: "Section SPEC-00002: copy its ID" });
  await expect(preview.getByRole("heading", { name: /Anchored/ }).getByRole("button")).toHaveCount(1);
  await badge.focus();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("SPEC-00002");
  await expect(tooltip).toContainText("specs/anchored.md");
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await badge.click();
    await expect(tooltip).toContainText("Copied SPEC-00002");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SPEC-00002");
  }
  await view(page, "Split").click();
  await expect(page.getByTestId("preview").getByRole("button", { name: /^Section SPEC-/ })).toHaveCount(4);
});

test("WYSIWYG shows badges and keeps the anchors when editing", async ({ page, specquer }) => {
  await openFile(page, "specs", "anchored.md");
  await view(page, "WYSIWYG").click();
  const editor = page.getByRole("textbox", { name: "Markdown content (WYSIWYG)" });
  await expect(editor.locator("[data-section-id]")).toHaveCount(4);
  await expect(editor).not.toContainText("<a id=");
  await editor.getByText("Paragraph 1 of filler text.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Edited.");
  await expect(saveStatus(page)).toHaveText("Unsaved changes");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  const text = await specquer.read("specs/anchored.md");
  expect(text).toContain("Paragraph 1 of filler text. Edited.");
  for (const id of ["SPEC-00001", "SPEC-00002", "SPEC-00003", "SPEC-00004"]) expect(text).toContain(`<a id="${id}"`);
  expect(text).toContain(`data-document-id="${DOC}"`);
});

test("typing # in a link target completes section IDs", async ({ page }) => {
  await openFile(page, "specs", "links.md");
  const editor = contentEditor(page);
  await typeAtEnd(editor, "\nSee [it](#Det");
  const option = page.getByRole("option", { name: /SPEC-00003/ });
  await expect(option).toContainText("Details");
  await option.click();
  await expect(editor).toContainText("See [it](anchored.md#SPEC-00003");
  await typeAtEnd(editor, ") and [that](anchored.md#SPEC-0000");
  await expect(page.getByRole("option")).toHaveCount(4);
  await page.getByRole("option", { name: /SPEC-00004/ }).click();
  await expect(editor).toContainText("[that](anchored.md#SPEC-00004");
});

test("following a link to a section opens the document at the section", async ({ page }) => {
  await openFile(page, "specs", "links.md");
  await view(page, "Preview").click();
  await page.getByTestId("preview").getByRole("link", { name: "the details" }).click();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("anchored.md");
  // The view type is per file; show the preview of the target, which scrolls to the section
  if ((await view(page, "Preview").getAttribute("aria-checked")) !== "true") await view(page, "Preview").click();
  await expect(page.getByTestId("preview").getByRole("heading", { name: /Details/ })).toBeInViewport();
});

test("Add section anchors lists the files, then anchors them", async ({ page, specquer }) => {
  await treeItem(page, "specs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add section anchors…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add section anchors" });
  await expect(dialog).toContainText("2 files will change");
  await expect(dialog.getByRole("list", { name: "Files to change" })).toContainText("specs/links.md");
  await expect(dialog.getByRole("list", { name: "Files to change" })).toContainText("specs/plain.md");
  await dialog.getByRole("button", { name: "Add anchors" }).click();
  await expect(dialog).toBeHidden();
  expect(await specquer.read("specs/plain.md")).toMatch(/^<a id="SPEC-0000\d" data-document-id="[a-z0-9]+"><\/a>\n\n<a id="SPEC-0000\d"><\/a>\n# Plain/);
  expect(await specquer.read("notes/n.md")).toBe("# Not sectioned\n");
});
