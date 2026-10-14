/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { type FakeModel, fakeModelConfig, startFakeModel } from "./fake-model";
import { test as base, expect, launch } from "./fixtures";

/** Specquer with a fake model and a sectioned spec to ask about. */
const test = base.extend<{ model: FakeModel }>({
  model: async ({}, use) => {
    const model = startFakeModel();
    await use(model);
    await model.stop();
  },
  files: async ({ model }, use) => {
    await use({
      "docs/.specquer-config.yaml": "folderType: BASELINE\ndefaultPrefix: REQ\n",
      "docs/copies.md": [
        '<a id="REQ-00001" data-uid="aaaaaaaaaaaa"></a>',
        "",
        "# Copies",
        "",
        "Intro to copies.",
        "",
        '<a id="REQ-00002" data-uid="bbbbbbbbbbbb"></a>',
        "## Renumbering",
        "",
        "A copied section gets a new number when it is renumbered.",
        "",
      ].join("\n"),
      "docs/other.md": "# Other\n\nUnrelated text.\n",
      ".specquer/shared/agent.config.yaml": fakeModelConfig(model),
    });
  },
});

const chatPane = (page: Page) => page.getByRole("region", { name: "Chat" });
const question = (page: Page) => page.getByRole("textbox", { name: "Question" });
const answers = (page: Page) => chatPane(page).getByRole("region", { name: "AI response" });

async function openChat(page: Page) {
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(question(page)).toBeVisible();
}

async function ask(page: Page, text: string) {
  await question(page).fill(text);
  await question(page).press("Enter");
}

test("asking streams an answer whose citation opens the section in Preview, and the conversation survives a reload", async ({ page, specquer, model }) => {
  await launch(page, specquer);
  // No file open: the open file's first section would come first among the sources
  await openChat(page);
  await ask(page, "How is a copied section renumbered?");
  const answer = answers(page).last();
  await expect(answer).toContainText("The answer is in the specs");
  await expect(answer).toContainText(/AI response · model · (under 1 s|\d+ s)/);
  expect(model.prompts.at(-1)).toContain("A copied section gets a new number");

  // The citation opens the section in Preview
  await answer.getByRole("button", { name: "[1]" }).first().click();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("copies.md");
  await expect(page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "Preview" })).toBeChecked();
  await expect(page.getByRole("heading", { name: "Renumbering" })).toBeInViewport();

  // The pane and the conversation come back after a reload
  await page.reload();
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page).first()).toContainText("The answer is in the specs");
  await expect(chatPane(page).getByLabel("Your question")).toHaveText("How is a copied section renumbered?");
});

test("an answer that takes longer than Bun's idle timeout to start still arrives", async ({ page, specquer, model }) => {
  test.setTimeout(60_000);
  // Bun closes a started response that is quiet for 10 seconds; keep-alive comments prevent it
  model.delay = 12_000;
  await launch(page, specquer);
  await openChat(page);
  await ask(page, "How is a copied section renumbered?");
  await expect(answers(page).last()).toContainText("The answer is in the specs", { timeout: 30_000 });
});

test("Clear empties the conversation, and Undo puts it back", async ({ page, specquer }) => {
  await launch(page, specquer);
  await openChat(page);
  await ask(page, "What about copies?");
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page).first()).toContainText("[1]");
  await chatPane(page).getByRole("button", { name: /Clear/ }).click();
  await expect(answers(page)).toHaveCount(0);
  await chatPane(page).getByRole("button", { name: "Undo" }).click();
  await expect(answers(page)).toHaveCount(1);
  await page.reload();
  await expect(answers(page)).toHaveCount(1);
});

test("Stop keeps the answer so far, marked stopped", async ({ page, specquer, model }) => {
  model.chatAnswer = "One two three four five six seven eight nine ten eleven twelve.";
  model.chunkDelay = 300;
  await launch(page, specquer);
  await openChat(page);
  await ask(page, "Tell me about copies");
  const answer = answers(page).last();
  await expect(answer).toContainText("One two");
  await chatPane(page).getByRole("button", { name: "Stop" }).click();
  await expect(answer).toContainText("stopped after");
  await expect(answer).not.toContainText("twelve");
  await expect(chatPane(page).getByRole("button", { name: "Send" })).toBeVisible();
});

test.describe("without a model", () => {
  test.use({ files: { "docs/a.md": "# A\n" } });

  test("the input is disabled, with the hint", async ({ page, specquer }) => {
    await launch(page, specquer);
    await openChat(page);
    await expect(question(page)).toBeDisabled();
    await expect(chatPane(page)).toContainText("The chat needs a model");
  });
});
