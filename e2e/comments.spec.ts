/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import { expect, launch, openFile, test } from "./fixtures";

const anchor = (id: string, uid: string) => `<a id="${id}" data-uid="${uid}"></a>`;
const DOC = `${anchor("SPEC-00001", "aaaaaaaaaaaa")}\n\n${anchor("SPEC-00002", "uidtwo000002")}\n# Design\n\nIntro.\n\n${anchor("SPEC-00003", "uidthree0003")}\n## Details\n\nThe details.\n\n* ${anchor("SPEC-00004", "uidfour00004")} A listed requirement\n`;
const SIDECAR = `threads:
  - threadUid: threadone001
    sectionUid: uidthree0003
    status: Open
    comments:
      - commentUid: commentone01
        createdBy: Bo
        createdAt: '2026-10-10T12:22:59Z'
        text: Is this right?
`;

test.use({
  files: {
    "specs/.specquer-config.yaml": "folderType: BASELINE\ndefaultPrefix: SPEC\n",
    "specs/design.md": DOC,
    "specs/design.md.comments.yaml": SIDECAR,
  },
});

test.beforeEach(async ({ page, specquer }) => {
  await launch(page, specquer);
});

function pane(page: Page) {
  return page.getByTestId("comment-groups");
}

async function openComments(page: Page) {
  await page.getByRole("button", { name: "Comments" }).click();
  await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
}

test("the comments and chat icons toggle three ways", async ({ page }) => {
  await openFile(page, "specs", "design.md");
  const comments = page.getByRole("button", { name: "Comments" });
  const chat = page.getByRole("button", { name: "Chat", exact: true });
  await comments.click();
  await expect(comments).toHaveAttribute("aria-pressed", "true");
  await chat.click();
  await expect(comments).toHaveAttribute("aria-pressed", "false");
  await expect(chat).toHaveAttribute("aria-pressed", "true");
  await chat.click();
  await expect(chat).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("separator", { name: /Resize the (chat|comments) pane/ })).toHaveCount(0);
});

test("a reply is written in the editor and saved when it loses focus", async ({ page, specquer }) => {
  await openFile(page, "specs", "design.md");
  await openComments(page);
  await pane(page).getByRole("button", { name: /^Is this right\?/ }).click();
  await pane(page).getByRole("button", { name: "Reply" }).click();
  const editor = pane(page).getByRole("textbox", { name: "Reply" });
  await expect(editor).toBeFocused();
  await page.keyboard.type("Yes, it is.");
  await page.getByRole("heading", { name: "Comments" }).click();
  await expect(pane(page).getByText("Yes, it is.")).toBeVisible();
  await expect.poll(() => specquer.read("specs/design.md.comments.yaml")).toContain("createdBy: E2E Tester");
  expect(await specquer.read("specs/design.md.comments.yaml")).toContain("text: Yes, it is.\n");
});

test("Escape abandons an edit; links typed or pasted stay text", async ({ page, specquer }) => {
  await openFile(page, "specs", "design.md");
  await openComments(page);
  await pane(page).getByRole("button", { name: /^Is this right\?/ }).click();
  await pane(page).getByRole("button", { name: "Edit" }).click();
  await page.keyboard.type(" Changed.");
  await page.keyboard.press("Escape");
  await expect(pane(page).getByRole("paragraph").filter({ hasText: "Is this right?" })).toHaveText("Is this right?");
  expect(await specquer.read("specs/design.md.comments.yaml")).toBe(SIDECAR);

  await pane(page).getByRole("button", { name: "Reply" }).click();
  await page.keyboard.type("See ");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/html", '<a href="https://example.com/spec">the spec</a>');
    data.setData("text/plain", "the spec");
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.getByRole("heading", { name: "Comments" }).click();
  await expect.poll(() => specquer.read("specs/design.md.comments.yaml")).toContain("See the spec (https://example.com/spec)");
  await expect(pane(page).locator("a")).toHaveCount(0);
});
