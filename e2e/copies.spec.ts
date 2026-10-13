/// <reference lib="dom" />
import { expect, launch, test, treeItem } from "./fixtures";

const ORIGINAL = `<a id="SPEC-00001" data-uid="docaaaaaaaa1"></a>\n\n<a id="SPEC-00002" data-uid="secbbbbbbbb2"></a>\n# Spec\n\nText.\n`;

// Both files are committed (the fixture commits everything), so neither Git nor the session can
// tell the original from the copy
test.use({
  files: {
    "specs/.specquer-config.yaml": "folderType: BASELINE\ndefaultPrefix: SPEC\n",
    "specs/spec.md": ORIGINAL,
    "specs/a-copy.md": ORIGINAL,
  },
});

test("a copied document is reported, and renumbering the copy keeps the original's IDs", async ({ page, specquer }) => {
  await launch(page, specquer);
  await treeItem(page, "specs").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Section problems…" }).click();
  const dialog = page.getByRole("dialog", { name: "Section problems" });
  await expect(dialog).toContainText("copies of one document");
  const copy = dialog.getByRole("listitem").filter({ hasText: "specs/a-copy.md" }).filter({ hasNotText: "specs/spec.md" });
  await copy.getByRole("button", { name: "Renumber this copy" }).click();
  await expect(dialog).toContainText("No problems found.");
  expect(await specquer.read("specs/spec.md")).toBe(ORIGINAL);
  const copied = await specquer.read("specs/a-copy.md");
  expect(copied).toMatch(/^<a id="SPEC-00003" data-uid="[a-z0-9]{12}"><\/a>\n\n<a id="SPEC-00004" data-uid="[a-z0-9]{12}"><\/a>\n# Spec/);
});
