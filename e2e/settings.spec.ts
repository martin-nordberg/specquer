/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { FAKE_MODEL_KEY_ENV, type FakeModel, fakeModelConfig, startFakeModel } from "./fake-model";
import { test as base, contentEditor, expect, hideTab, launch, openFile, saveStatus, treeItem, typeAtEnd } from "./fixtures";

const SHARED_AGENT = "# Shared agent settings\nsummaries:\n  concurrency: 2\n";
const SPECS_CONFIG = "folderType: BASELINE\ndefaultPrefix: SPEC\n";
const anchor = (id: string, uid: string) => `<a id="${id}" data-uid="${uid}"></a>`;
const OLD = `${anchor("SPEC-00001", "docaaaaaaaa1")}\n\n${anchor("SPEC-00002", "secbbbbbbbb2")}\n# Old\n\nText.\n`;

/** Specquer with a fake model server running, but no model configured. */
const test = base.extend<{ model: FakeModel }>({
  model: async ({}, use) => {
    const model = startFakeModel();
    await use(model);
    await model.stop();
  },
  files: async ({ model: _model }, use) => {
    await use({
      ".specquer/shared/agent.config.yaml": SHARED_AGENT,
      "specs/.specquer-config.yaml": SPECS_CONFIG,
      "specs/a.md": `# A\n\n${Array(80).fill("text").join(" ")}\n`,
      "specs/old/old.md": OLD,
      "notes/n.md": "# Note\n",
    });
  },
});

test.beforeEach(async ({ page, specquer }) => {
  await launch(page, specquer);
});

const settingsDialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });
const folderDialog = (page: Page) => page.getByRole("dialog", { name: "Folder settings" });

async function openFolderSettings(page: Page, ...names: string[]) {
  for (const name of names.slice(0, -1)) await treeItem(page, name).click();
  await treeItem(page, names.at(-1)!).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Settings…" }).click();
  await expect(folderDialog(page)).toBeVisible();
}

test("a personal model set in the dialog works at once and leaves the shared file alone", async ({ page, specquer, model }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = settingsDialog(page);
  await expect(dialog.getByLabel("Model status")).toContainText("Summaries are off");
  await dialog.getByRole("textbox", { name: "Model ID" }).fill("fake/model");
  await dialog.getByRole("textbox", { name: "Base URL" }).fill(model.baseUrl);
  await dialog.getByRole("textbox", { name: "API key variable" }).fill(FAKE_MODEL_KEY_ENV);
  await expect(dialog).toContainText(`${FAKE_MODEL_KEY_ENV}: found.`);
  await dialog.getByRole("button", { name: "Test" }).click();
  await expect(dialog.getByRole("status")).toContainText("The model answered in");
  expect(model.prompts).toEqual(["Reply with the word OK."]);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  expect(await specquer.read(".specquer/shared/agent.config.yaml")).toBe(SHARED_AGENT);
  const personal = await specquer.read(".specquer/user/agent.config.yaml");
  expect(personal).toContain("name: fake/model");
  expect(personal).not.toContain("e2e-key");

  await openFile(page, "specs", "a.md");
  await page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "Preview" }).click();
  const slider = page.getByRole("slider", { name: "Summary level" });
  await slider.focus();
  await slider.press("ArrowLeft");
  await expect(page.getByTestId("preview").getByText("Summary of A.")).toBeVisible();
});

test("a model error from the test is shown", async ({ page, model }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = settingsDialog(page);
  await dialog.getByRole("textbox", { name: "Model ID" }).fill("fake/model");
  await dialog.getByRole("textbox", { name: "Base URL" }).fill(model.baseUrl.replace("/v1", "/wrong"));
  await dialog.getByRole("textbox", { name: "API key variable" }).fill(FAKE_MODEL_KEY_ENV);
  await dialog.getByRole("button", { name: "Test" }).click();
  await expect(dialog.getByRole("alert")).toContainText("doesn't know the model fake/model");
});

test("a shared model that arrives through Git waits for the user's approval", async ({ page, specquer, model }) => {
  // As a pull would bring it: written behind the dialog's back
  await specquer.write(".specquer/shared/agent.config.yaml", fakeModelConfig(model));
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = settingsDialog(page);
  const approval = dialog.getByRole("alert", { name: "Model approval" });
  await expect(approval).toContainText(FAKE_MODEL_KEY_ENV);
  await expect(approval).toContainText(model.baseUrl);
  await expect(dialog.getByLabel("Model status")).toContainText("haven't approved");
  expect(model.prompts).toEqual([]);
  await approval.getByRole("button", { name: "Approve this model" }).click();
  await expect(approval).toBeHidden();
  await expect(dialog.getByLabel("Model status")).toContainText("Summaries are on, with fake/model.");
  expect(await specquer.read(".specquer/user/approvals.yaml")).toContain(model.baseUrl);
});

test("a folder switched off isn't anchored, and keeps its IDs when switched back", async ({ page, specquer }) => {
  await openFolderSettings(page, "specs", "old");
  await expect(folderDialog(page)).toContainText("Inherited: from specs: Baseline");
  await folderDialog(page).getByRole("radio", { name: /^Non-sectioned/ }).click();
  await folderDialog(page).getByRole("button", { name: "Save" }).click();
  await expect(folderDialog(page).getByRole("status")).toContainText("The anchors stay in its files");
  await folderDialog(page).getByRole("button", { name: "Close" }).first().click();
  expect((await specquer.read("specs/old/.specquer-config.yaml")).endsWith("folderType: NONSECTIONED\n")).toBe(true);

  await openFile(page, "old", "old.md");
  await typeAtEnd(contentEditor(page), "\n## Added while off");
  await hideTab(page);
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await specquer.read("specs/old/old.md")).toBe(`${OLD}\n## Added while off`);

  await openFolderSettings(page, "old");
  await folderDialog(page).getByRole("radio", { name: /^Inherited/ }).click();
  await folderDialog(page).getByRole("button", { name: "Save" }).click();
  await expect(folderDialog(page).getByRole("status")).toContainText("The folder is sectioned now");
  await folderDialog(page).getByRole("button", { name: "Add section anchors…" }).last().click();
  const anchors = page.getByRole("dialog", { name: "Add section anchors" });
  await expect(anchors).toContainText("1 file will change");
  await anchors.getByRole("button", { name: "Add anchors" }).click();
  await expect(anchors).toBeHidden();
  const text = await specquer.read("specs/old/old.md");
  expect(text.startsWith(OLD)).toBe(true);
  expect(text).toMatch(/<a id="SPEC-0000[3-9]" data-uid="[a-z0-9]+"><\/a>\n## Added while off/);
  expect(await specquer.exists("specs/old/.specquer-config.yaml")).toBe(false);
});

test("a folder gets a type and a prefix from the dialog", async ({ page, specquer }) => {
  await openFolderSettings(page, "notes");
  await expect(folderDialog(page)).toContainText("Inherited: non-sectioned");
  // The button moved to the folder's menu (Step 015); the dialog offers it only after a save
  await expect(folderDialog(page).getByRole("button", { name: "Add section anchors…" })).toHaveCount(0);
  await folderDialog(page).getByRole("radio", { name: /^Auxiliary/ }).click();
  await folderDialog(page).getByRole("textbox", { name: "Default prefix" }).fill("note");
  await folderDialog(page).getByRole("button", { name: "Save" }).click();
  await folderDialog(page).getByRole("button", { name: "Add section anchors…" }).last().click();
  await page.getByRole("dialog", { name: "Add section anchors" }).getByRole("button", { name: "Add anchors" }).click();
  await expect(page.getByRole("dialog", { name: "Add section anchors" })).toBeHidden();
  expect(await specquer.read("notes/n.md")).toMatch(/^<a id="NOTE-00001" data-uid="[a-z0-9]+"><\/a>\n\n<a id="NOTE-00002"/);
  expect(await specquer.read("notes/.specquer-config.yaml")).toMatch(/folderType: AUXILIARY\ndefaultPrefix: NOTE\n$/);
});
