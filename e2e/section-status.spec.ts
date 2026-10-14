/// <reference lib="dom" />
import type { Locator, Page } from "@playwright/test";
import { contentEditor, expect, hideTab, launch, openFile, prefixConfig, saveStatus, test, treeItem, typeAtEnd } from "./fixtures";

const anchor = (id: string, uid: string, status?: string) => `<a id="${id}" data-uid="${uid}"${status === undefined ? "" : ` data-status="${status}"`}></a>`;
const doc = (status2?: string) =>
  `${anchor("SPEC-00001", "aaaaaaaaaaaa")}\n\n${anchor("SPEC-00002", "uidtwo000002", status2)}\n# Design\n\nIntro.\n\n${anchor("SPEC-00003", "uidthree0003")}\n## Details\n\n* ${anchor("SPEC-00004", "uidfour00004")} A listed requirement\n`;

test.use({
  files: {
    "specs/.specquer-config.yaml": "folderType: BASELINE\ndefaultPrefix: SPEC\n",
    "specs/design.md": doc(),
  },
});

test.beforeEach(async ({ page, specquer }) => {
  await launch(page, specquer);
});

function view(page: Page, name: string) {
  return page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name });
}

/** Opens a badge's Section attributes dialog with the mouse and chooses a status. */
async function chooseStatus(page: Page, badge: Locator, status: string) {
  await badge.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Section attributes…" }).click();
  const dialog = page.getByRole("dialog", { name: "Section attributes" });
  await dialog.getByRole("combobox", { name: "Status" }).selectOption({ label: status });
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toBeHidden();
}

test("a status set from the preview's badge is an unsaved edit that subsections inherit, and is saved", async ({ page, specquer }) => {
  await openFile(page, "specs", "design.md");
  await view(page, "Preview").click();
  const preview = page.getByTestId("preview");
  await expect(preview.getByRole("button", { name: "Section SPEC-00003, Draft (inherited)" })).toBeVisible();
  await chooseStatus(page, preview.getByRole("button", { name: /^Section SPEC-00002,/ }), "Approved");
  await expect(saveStatus(page)).toHaveText("Unsaved changes");
  await expect(preview.getByRole("button", { name: "Section SPEC-00002, Approved" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Section SPEC-00003, Approved (inherited)" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Section SPEC-00004, Approved (inherited)" })).toBeVisible();
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("specs/design.md")).toBe(doc("Approved"));
  await page.reload();
  await expect(page.getByTestId("preview").getByRole("button", { name: "Section SPEC-00003, Approved (inherited)" })).toBeVisible();
  // Inherited removes it again
  await chooseStatus(page, page.getByTestId("preview").getByRole("button", { name: /^Section SPEC-00002,/ }), "Inherited (Draft)");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("specs/design.md")).toBe(doc());
});

test("in split view the change shows in the text and Ctrl+Z there undoes it", async ({ page }) => {
  await openFile(page, "specs", "design.md");
  await view(page, "Split").click();
  await chooseStatus(page, page.getByTestId("preview").getByRole("button", { name: /^Section SPEC-00002,/ }), "Testing");
  const editor = contentEditor(page);
  await expect(editor).toContainText('data-status="Testing"');
  await editor.click();
  await editor.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("data-status");
});

test("a status set from a WYSIWYG badge is saved", async ({ page, specquer }) => {
  await openFile(page, "specs", "design.md");
  await view(page, "WYSIWYG").click();
  const editor = page.getByRole("textbox", { name: "Markdown content (WYSIWYG)" });
  const badge = editor.locator("[data-section-id='SPEC-00003']");
  await badge.hover();
  await expect(badge).toHaveAttribute("title", "SPEC-00003 - Draft (inherited)");
  await chooseStatus(page, badge, "Peer Review");
  await expect(saveStatus(page)).toHaveText("Unsaved changes");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  // Milkdown writes a blank line between the anchor and its heading
  expect(await specquer.read("specs/design.md")).toMatch(/<a id="SPEC-00003" data-uid="uidthree0003" data-status="Peer Review"><\/a>\n+## Details/);
});

test("the keyboard opens the badge's menu, which copies the ID", async ({ page, context, browserName }) => {
  await openFile(page, "specs", "design.md");
  await view(page, "Preview").click();
  const badge = page.getByTestId("preview").getByRole("button", { name: /^Section SPEC-00003,/ });
  await badge.focus();
  await page.keyboard.press("Shift+F10");
  const copy = page.getByRole("menuitem", { name: "Copy this section ID" });
  await expect(copy).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Section attributes…" })).toBeEnabled();
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await copy.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SPEC-00003");
  } else await page.keyboard.press("Escape");
  await expect(copy).toBeHidden();
});

test("a status written in another case is corrected on save", async ({ page, specquer }) => {
  await specquer.write("specs/design.md", doc(" approved"));
  await openFile(page, "specs", "design.md");
  await typeAtEnd(contentEditor(page), "\nMore.");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("specs/design.md")).toBe(`${doc("Approved")}\nMore.`);
});

test("a status that isn't allowed rings the badge and is a section problem", async ({ page, specquer }) => {
  await specquer.write("specs/design.md", doc("Revieww"));
  await openFile(page, "specs", "design.md");
  await view(page, "Preview").click();
  const badge = page.getByTestId("preview").getByRole("button", { name: "Section SPEC-00002, Revieww (not allowed)" });
  await expect(badge).toHaveClass(/section-badge-problem/);
  // Its subsections inherit past it
  await expect(page.getByTestId("preview").getByRole("button", { name: "Section SPEC-00003, Draft (inherited)" })).toBeVisible();
  await treeItem(page, "specs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Section problems…" }).click();
  await expect(page.getByRole("dialog", { name: "Section problems" })).toContainText("specs/design.md, line 3: SPEC-00002's status “Revieww” isn't allowed for SPEC.");
});

test("a prefix's own statuses are offered; an unusable prefix.config.yaml falls back to the defaults and is reported", async ({ page, specquer }) => {
  await specquer.write(...prefixConfig("SPEC", ["Proposed", "Accepted"]));
  await openFile(page, "specs", "design.md");
  await view(page, "Preview").click();
  const preview = page.getByTestId("preview");
  await expect(preview.getByRole("button", { name: "Section SPEC-00002, Proposed (inherited)" })).toBeVisible();
  await preview.getByRole("button", { name: /^Section SPEC-00002,/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Section attributes…" }).click();
  const dialog = page.getByRole("dialog", { name: "Section attributes" });
  await expect(dialog.getByRole("combobox", { name: "Status" }).locator("option")).toHaveText(["Inherited (Proposed)", "Proposed", "Accepted"]);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await specquer.write(...prefixConfig("SPEC", ["Open", "open"]));
  await treeItem(page, "specs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Section problems…" }).click();
  const problems = page.getByRole("dialog", { name: "Section problems" });
  await expect(problems).toContainText('.specquer/shared/SPEC/prefix.config.yaml: "open" is listed twice, so SPEC uses the default statuses.');
  await problems.getByRole("button", { name: "Close" }).first().click();
  // Opening the menu loads the lists again: back to the defaults
  await preview.getByRole("button", { name: /^Section SPEC-00002,/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Section attributes…" }).click();
  await expect(dialog.getByRole("combobox", { name: "Status" }).locator("option")).toHaveText(["Inherited (Draft)", "Draft", "Approved", "In Development", "Peer Review", "Testing", "Complete"]);
});
