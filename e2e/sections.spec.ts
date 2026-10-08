/// <reference lib="dom" />
import { contentEditor, expect, hideTab, launch, openFile, saveStatus, test, treeItem, typeAtEnd } from "./fixtures";

const DOC = "aaaaaaaaaaaa";
/** An anchor as Specquer writes it. */
const anchor = (id: string, uid: string) => `<a id="${id}" data-uid="${uid}"></a>`;
const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of filler text.`).join("\n\n");

test.use({
  files: {
    ".specquer/shared/section-prefixes.config.yaml": 'prefixes:\n  "specs/": SPEC\n',
    "specs/plain.md": "# Plain\n\nIntro text.\n",
    "specs/anchored.md": `${anchor("SPEC-00001", DOC)}\n\n${anchor("SPEC-00002", "uidtwo000002")}\n# Anchored\n\n${filler}\n\n${anchor("SPEC-00003", "uidthree0003")}\n## Details\n\n* ${anchor("SPEC-00004", "uidfour00004")} A listed requirement\n`,
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
  expect(saved).toMatch(
    /^<a id="SPEC-00005" data-uid="[a-z0-9]{12}"><\/a>\n\n<a id="SPEC-00006" data-uid="[a-z0-9]{12}"><\/a>\n# Plain\n\nIntro text.\n\n<a id="SPEC-00007" data-uid="[a-z0-9]{12}"><\/a>\n## Added$/,
  );
  await expect(editor).toContainText('<a id="SPEC-00007" data-uid=');
  // The cursor stayed at the end of the text typed; typing after a pause is a separate undo step
  await page.waitForTimeout(600);
  await page.keyboard.type(" here");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toContainText('<a id="SPEC-00007" data-uid=');
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
  expect(text).toContain(anchor("SPEC-00001", DOC));
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
  expect(await specquer.read("specs/plain.md")).toMatch(/^<a id="SPEC-0000\d" data-uid="[a-z0-9]+"><\/a>\n\n<a id="SPEC-0000\d" data-uid="[a-z0-9]+"><\/a>\n# Plain/);
  expect(await specquer.read("notes/n.md")).toBe("# Not sectioned\n");
});

/** Pastes text into a CodeMirror editor at its end, as the browser would from the clipboard. */
async function pasteAtEnd(editor: import("@playwright/test").Locator, text: string) {
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.evaluate((element, pasted) => {
    const data = new DataTransfer();
    data.setData("text/plain", pasted);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

const details = `${anchor("SPEC-00003", "uidthree0003")}\n## Details`;

test("a section copied within a document gets a new ID on save", async ({ page, specquer }) => {
  await openFile(page, "specs", "anchored.md");
  const editor = contentEditor(page);
  await pasteAtEnd(editor, `\n${details.replace("Details", "Copied details")}\n`);
  await expect(editor).toContainText('<a id=""></a>## Copied details');
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  const text = await specquer.read("specs/anchored.md");
  expect(text).toContain(details);
  expect(text).toMatch(/<a id="SPEC-00005" data-uid="[a-z0-9]{12}"><\/a>\n## Copied details/);
});

test("a section copied from another document becomes a placeholder", async ({ page }) => {
  await openFile(page, "specs", "plain.md");
  const editor = contentEditor(page);
  await pasteAtEnd(editor, `\n${details}\n`);
  await expect(editor).toContainText('<a id=""></a>## Details');
});

test("a section cut and pasted keeps its ID", async ({ page, specquer }) => {
  await openFile(page, "specs", "anchored.md");
  const editor = contentEditor(page);
  await editor.click();
  await editor.press("ControlOrMeta+a");
  // Cut and paste through the editor's clipboard events
  await editor.evaluate((element) => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("cut", { clipboardData: data, bubbles: true, cancelable: true }));
    (window as unknown as { clipboard: DataTransfer }).clipboard = data;
  });
  await expect(editor).toHaveText("");
  await editor.evaluate((element) => {
    const data = (window as unknown as { clipboard: DataTransfer }).clipboard;
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  // The view follows the paste to the end; the editor's text has no line breaks
  await expect(editor).toContainText(details.replace("\n", ""));
  await typeAtEnd(editor, "\nMore.");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("specs/anchored.md")).toContain(details);
});

test("a duplicate made outside Specquer is reported and renumbered from its badge", async ({ page, specquer }) => {
  await specquer.write("specs/plain.md", `${anchor("SPEC-00010", "plaindoc0001")}\n\n# Plain\n\n${details}\n`);
  await openFile(page, "specs", "plain.md");
  await view(page, "Preview").click();
  const preview = page.getByTestId("preview");
  const badge = preview.getByRole("button", { name: "Section SPEC-00003 (ID used more than once): copy its ID" });
  await expect(badge).toBeVisible();
  await badge.focus();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Also used by a copy in specs/anchored.md");
  await tooltip.getByRole("button", { name: "Renumber this one" }).click();
  // The heading without an anchor gets SPEC-00011 in the same write
  await expect(page.getByRole("status", { name: "Section changes" })).toContainText("SPEC-00003 in “Details” is now SPEC-00012.");
  await expect(preview.getByRole("button", { name: "Section SPEC-00012: copy its ID" })).toBeVisible();
  expect(await specquer.read("specs/plain.md")).toMatch(/<a id="SPEC-00012" data-uid="[a-z0-9]{12}"><\/a>\n## Details/);
  expect(await specquer.read("specs/anchored.md")).toContain(details);
});

test("an edited ID is put back on save, with a notice", async ({ page, specquer }) => {
  await openFile(page, "specs", "anchored.md");
  await typeAtEnd(contentEditor(page), "\nMore.");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  const recorded = await specquer.read("specs/anchored.md");
  await specquer.write("specs/anchored.md", recorded.replace('id="SPEC-00003"', 'id="SPEC-00099"'));
  await page.reload();
  await expect(contentEditor(page)).toContainText("Anchored");
  await typeAtEnd(contentEditor(page), " Again.");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  await expect(page.getByRole("status", { name: "Section changes" })).toContainText("SPEC-00003 was put back");
  expect(await specquer.read("specs/anchored.md")).toContain(details);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("status", { name: "Section changes" })).toBeHidden();
});

test("Section problems lists duplicates, stray anchors and conflicts", async ({ page, specquer }) => {
  await specquer.write("specs/plain.md", `# Plain\n\nText ${anchor("SPEC-00004", "uidfour00004")} moved.\n`);
  await specquer.write("specs/links.md", "# Links\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n");
  await treeItem(page, "specs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Section problems…" }).click();
  const dialog = page.getByRole("dialog", { name: "Section problems" });
  await expect(dialog).toContainText("specs/plain.md, line 3: the anchor SPEC-00004 isn't in a section's place");
  await expect(dialog).toContainText("specs/links.md holds merge conflict markers");
});
