/// <reference lib="dom" />
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Locator, type Page, test as base, expect } from "@playwright/test";
import { FAKE_MODEL_KEY_ENV } from "./fake-model";

/** A Specquer server on its own temporary root folder. */
export interface Specquer {
  root: string;
  /** The launch URL, with the session token. */
  url: string;
  origin: string;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export const fixtureFiles: Record<string, string> = {
  "docs/a.md":
    '---\ntitle: Alpha\n---\n# Alpha <a name="r7k2" data-status="draft"></a>\n\nSee [beta](../b.md) and [the anchor](#r7k2).\n\n<img src="x.png" onerror="window.__xss = true">\n',
  "docs/notes.txt": "not shown in the tree\n",
  "docs/deep/c.md": "# Gamma\n",
  "b.md": "# Beta\n\nBody of beta.\n",
};

const repository = join(import.meta.dir, "..");

async function startSpecquer(files: Record<string, string>): Promise<Specquer & { stop(): Promise<void> }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "specquer-e2e-")));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await Bun.write(join(root, path), text);
  }
  await Bun.$`git -C ${root} init -q && git -C ${root} add -A && git -C ${root} -c user.email=e2e@example.com -c user.name=e2e commit -qm fixtures`.quiet();

  // Run from `server` so its bunfig.toml (the Tailwind plugin) applies. Production mode bundles
  // once at startup; development mode's file watchers run out when many servers run in parallel.
  const child = Bun.spawn(["bun", "src/index.ts", root, "--no-open"], {
    cwd: join(repository, "server"),
    // The key for a fake model, which tests that summarize configure
    env: { ...process.env, NODE_ENV: "production", [FAKE_MODEL_KEY_ENV]: "e2e-key" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  let output = "";
  const reader = child.stdout.getReader();
  let url: string | undefined;
  while (url === undefined) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`Specquer exited before printing its URL:\n${output}${await new Response(child.stderr).text()}`);
    output += decoder.decode(value);
    url = output.match(/Open (http:\/\/\S+)/)?.[1];
  }
  reader.releaseLock();
  const origin = new URL(url).origin;
  return {
    root,
    url,
    origin,
    read: (path) => Bun.file(join(root, path)).text(),
    write: async (path, text) => {
      await Bun.write(join(root, path), text);
    },
    exists: (path) => Bun.file(join(root, path)).exists(),
    async stop() {
      child.kill();
      await child.exited;
      await rm(root, { recursive: true, force: true });
    },
  };
}

export const test = base.extend<{ specquer: Specquer; files: Record<string, string> }>({
  files: [fixtureFiles, { option: true }],
  specquer: async ({ files }, use) => {
    const specquer = await startSpecquer(files);
    await use(specquer);
    await specquer.stop();
  },
});

export { expect };

/** Opens Specquer with its launch URL and waits for the tree. */
export async function launch(page: Page, specquer: Specquer) {
  await page.goto(specquer.url);
  await expect(page.getByRole("tree", { name: "Files" })).toBeVisible();
}

export function treeItem(page: Page, name: string): Locator {
  return page.getByRole("treeitem", { name, exact: true }).locator(":scope > button");
}

export async function openFile(page: Page, ...names: string[]) {
  for (const name of names.slice(0, -1)) {
    const item = page.getByRole("treeitem", { name, exact: true });
    if ((await item.getAttribute("aria-expanded")) !== "true") await treeItem(page, name).click();
  }
  await treeItem(page, names.at(-1)!).click();
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText(names.at(-1)!);
}

export function contentEditor(page: Page): Locator {
  return page.getByRole("textbox", { name: "Markdown content", exact: true });
}

export function frontmatterEditor(page: Page): Locator {
  return page.getByRole("textbox", { name: "Front matter (YAML)" });
}

export function saveStatus(page: Page): Locator {
  return page.getByRole("status", { name: "Save status" });
}

/** Simulates the tab losing focus, which triggers autosave. */
export async function hideTab(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
}

/** Types at the end of a CodeMirror editor. */
export async function typeAtEnd(editor: Locator, text: string) {
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially(text);
}
