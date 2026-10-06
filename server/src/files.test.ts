import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tempRoot, testApp } from "./test-support.ts";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function setup(files: Record<string, string>, options: { git?: boolean } = {}) {
  const temp = await tempRoot(files, options);
  cleanups.push(temp.cleanup);
  return { root: temp.root, ...testApp(temp.root) };
}

const read = (root: string, path: string) => Bun.file(join(root, path)).text();

interface TreeJson {
  root: { children: Array<{ kind: string; name: string; path: string; children?: unknown[] }> };
  truncated: boolean;
}

function flatten(node: { children?: unknown[]; path?: string; kind?: string }, out: string[] = []): string[] {
  for (const child of (node.children ?? []) as Array<{ path: string; kind: string; children?: unknown[] }>) {
    out.push(child.kind === "folder" ? `${child.path}/` : child.path);
    flatten(child, out);
  }
  return out;
}

describe("GET /api/tree", () => {
  test("lists folders with Markdown files, folders first, skipping hidden folders", async () => {
    const { request } = await setup({
      "z.md": "",
      "a/b.md": "",
      "a/notes.txt": "",
      "empty/readme.txt": "",
      "node_modules/pkg/README.md": "",
      ".specquer/user/x.md": "",
      "B.MD": "",
    });
    const tree = (await (await request("/api/tree")).json()) as TreeJson;
    expect(flatten(tree.root)).toEqual(["a/", "a/b.md", "B.MD", "z.md"]);
    expect(tree.truncated).toBe(false);
  });

  test("respects .gitignore in a Git repository", async () => {
    const { root, request } = await setup({ ".gitignore": "build/\nsecret.md\n", "a.md": "", "build/x.md": "", "secret.md": "" }, { git: true });
    await Bun.write(join(root, "new.md"), "untracked but not ignored");
    const tree = (await (await request("/api/tree")).json()) as TreeJson;
    expect(flatten(tree.root)).toEqual(["a.md", "new.md"]);
  });
});

describe("GET /api/file", () => {
  test("returns the text and a version", async () => {
    const { request } = await setup({ "a/b.md": "# B\r\n" });
    const res = await request("/api/file?path=a/b.md");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; version: string };
    expect(body.text).toBe("# B\r\n");
    expect(body.version).toMatch(/^[0-9a-f]{64}$/);
  });

  test("keeps a byte-order mark", async () => {
    const { request } = await setup({ "a.md": "﻿# A" });
    expect(((await (await request("/api/file?path=a.md")).json()) as { text: string }).text).toBe("﻿# A");
  });

  test.each([
    ["../outside.md", 400],
    ["%2e%2e/outside.md", 400],
    ["/etc/passwd.md", 400],
    [".git/x.md", 400],
    ["notes.txt", 400],
    ["missing.md", 404],
  ])("rejects %p", async (path, status) => {
    const { request } = await setup({ "notes.txt": "x" });
    expect((await request(`/api/file?path=${path}`)).status).toBe(status);
  });

  test("won't follow a symbolic link out of the root", async () => {
    const outside = await tempRoot({ "secret.md": "secret" });
    cleanups.push(outside.cleanup);
    const { root, request } = await setup({});
    await symlink(join(outside.root, "secret.md"), join(root, "link.md"));
    await symlink(outside.root, join(root, "linked"));
    expect((await request("/api/file?path=link.md")).status).toBe(403);
    expect((await request("/api/file?path=linked/secret.md")).status).toBe(403);
    expect((await request("/api/rename", { method: "POST", body: { path: "linked/secret.md", newName: "x.md" } })).status).toBe(403);
    expect((await request("/api/entry?path=linked/secret.md", { method: "DELETE" })).status).toBe(403);
    expect(await read(outside.root, "secret.md")).toBe("secret");
  });
});

describe("PUT /api/file", () => {
  test("saves when the version matches, atomically", async () => {
    const { root, request } = await setup({ "a.md": "old" });
    const { version } = (await (await request("/api/file?path=a.md")).json()) as { version: string };
    const res = await request("/api/file?path=a.md", { method: "PUT", body: { text: "new\r\n", baseVersion: version } });
    expect(res.status).toBe(200);
    expect(await read(root, "a.md")).toBe("new\r\n");
    expect(await readdir(root)).toEqual(["a.md"]);
    const { version: next } = (await res.json()) as { version: string };
    expect(next).not.toBe(version);
  });

  test("refuses with 409 when the file changed on disk", async () => {
    const { root, request } = await setup({ "a.md": "old" });
    const { version } = (await (await request("/api/file?path=a.md")).json()) as { version: string };
    await Bun.write(join(root, "a.md"), "changed by an agent");
    const res = await request("/api/file?path=a.md", { method: "PUT", body: { text: "mine", baseVersion: version } });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { version: string };
    expect(await read(root, "a.md")).toBe("changed by an agent");
    // Keeping my version: save again based on theirs
    const retry = await request("/api/file?path=a.md", { method: "PUT", body: { text: "mine", baseVersion: body.version } });
    expect(retry.status).toBe(200);
    expect(await read(root, "a.md")).toBe("mine");
  });

  test("doesn't create files", async () => {
    const { request } = await setup({});
    expect((await request("/api/file?path=new.md", { method: "PUT", body: { text: "x", baseVersion: "" } })).status).toBe(404);
  });
});

describe("POST /api/rename", () => {
  test("renames a file and updates the UI state", async () => {
    const { root, request } = await setup({ "d/a.md": "A", "d/b.md": "B" });
    await request("/api/uistate", { method: "PATCH", body: { currentFile: "d/a.md", files: { "d/a.md": { viewType: "split" } } } });
    const res = await request("/api/rename", { method: "POST", body: { path: "d/a.md", newName: "c.md" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; uiState: { currentFile: string; files: object } };
    expect(body.path).toBe("d/c.md");
    expect(body.uiState.currentFile).toBe("d/c.md");
    expect(body.uiState.files).toEqual({ "d/c.md": { viewType: "split" } });
    expect(await read(root, "d/c.md")).toBe("A");
  });

  test("renames a folder and everything in the UI state inside it", async () => {
    const { root, request } = await setup({ "d/sub/a.md": "A" });
    await request("/api/uistate", { method: "PATCH", body: { expandedFolders: ["d", "d/sub"], currentFile: "d/sub/a.md" } });
    const res = await request("/api/rename", { method: "POST", body: { path: "d", newName: "e" } });
    const body = (await res.json()) as { uiState: { expandedFolders: string[]; currentFile: string } };
    expect(body.uiState).toMatchObject({ expandedFolders: ["e", "e/sub"], currentFile: "e/sub/a.md" });
    expect(await read(root, "e/sub/a.md")).toBe("A");
  });

  test("409 when the name is taken", async () => {
    const { request } = await setup({ "a.md": "", "b.md": "", "d/x.md": "" });
    expect((await request("/api/rename", { method: "POST", body: { path: "a.md", newName: "b.md" } })).status).toBe(409);
    expect((await request("/api/rename", { method: "POST", body: { path: "a.md", newName: "d" } })).status).toBe(400);
    expect((await request("/api/rename", { method: "POST", body: { path: "d", newName: "b.md" } })).status).toBe(409);
  });

  test.each(["x.txt", "x", "../x.md", "sub/x.md", ".git", ".md", ""])("rejects the name %p for a file", async (newName) => {
    const { request } = await setup({ "a.md": "" });
    expect((await request("/api/rename", { method: "POST", body: { path: "a.md", newName } })).status).toBe(400);
  });

  test("can't rename the root", async () => {
    const { request } = await setup({});
    expect((await request("/api/rename", { method: "POST", body: { path: "", newName: "x" } })).status).toBe(400);
  });
});

describe("delete", () => {
  test("preview lists hidden files and uncommitted changes", async () => {
    const { root, request } = await setup({ "d/a.md": "A", "d/img.png": "png", ".gitignore": "*.log\n" }, { git: true });
    await Bun.write(join(root, "d/new.md"), "new");
    await Bun.write(join(root, "d/a.md"), "changed");
    await Bun.write(join(root, "d/debug.log"), "log");
    const res = await request("/api/entry/delete-preview?path=d");
    expect(await res.json()).toEqual({
      path: "d",
      kind: "folder",
      files: ["d/a.md", "d/debug.log", "d/img.png", "d/new.md"],
      fileCount: 4,
      uncommitted: ["d/a.md", "d/debug.log", "d/new.md"],
    });
  });

  test("preview outside Git reports unknown commit status", async () => {
    const { request } = await setup({ "a.md": "" });
    expect(await (await request("/api/entry/delete-preview?path=a.md")).json()).toMatchObject({ kind: "file", files: ["a.md"], uncommitted: null });
  });

  test("deletes a folder and its UI state", async () => {
    const { root, request } = await setup({ "d/a.md": "", "b.md": "" });
    await request("/api/uistate", { method: "PATCH", body: { expandedFolders: ["d"], currentFile: "d/a.md", recentFiles: ["b.md"] } });
    const res = await request("/api/entry?path=d", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { uiState: object }).uiState).toMatchObject({ expandedFolders: [], recentFiles: ["b.md"] });
    expect(await readdir(root)).toEqual(expect.arrayContaining(["b.md", ".specquer"]));
    expect(await readdir(root)).not.toContain("d");
  });

  test("refuses the root, protected folders and missing entries", async () => {
    const { root, request } = await setup({ "a.md": "" });
    await mkdir(join(root, ".git"));
    expect((await request("/api/entry?path=", { method: "DELETE" })).status).toBe(400);
    expect((await request("/api/entry?path=.git", { method: "DELETE" })).status).toBe(400);
    expect((await request("/api/entry?path=missing", { method: "DELETE" })).status).toBe(404);
  });
});

describe("UI state", () => {
  test("is created with a .gitignore, and reloaded", async () => {
    const { root, request } = await setup({ "a.md": "" });
    expect(await (await request("/api/uistate")).json()).toMatchObject({ version: 1, recentFiles: [] });
    await request("/api/uistate", { method: "PATCH", body: { theme: "dark", currentFile: "a.md", treePaneFraction: 0.3 } });
    expect(await read(root, ".specquer/user/.gitignore")).toBe("*\n");
    expect(await read(root, ".specquer/user/uistate.yaml")).toContain("theme: dark");
    expect(await (await request("/api/uistate")).json()).toMatchObject({ theme: "dark", currentFile: "a.md", treePaneFraction: 0.3 });
  });

  test("keeps an existing .gitignore", async () => {
    const { root, request } = await setup({ ".specquer/keep.txt": "" });
    await mkdir(join(root, ".specquer/user"));
    await Bun.write(join(root, ".specquer/user/.gitignore"), "custom\n");
    await request("/api/uistate", { method: "PATCH", body: { theme: "light" } });
    expect(await read(root, ".specquer/user/.gitignore")).toBe("custom\n");
  });

  test("falls back to defaults for invalid content and drops vanished files", async () => {
    const { root, request } = await setup({ "a.md": "" });
    await mkdir(join(root, ".specquer/user"), { recursive: true });
    await Bun.write(join(root, ".specquer/user/uistate.yaml"), "recentFiles: [a.md, gone.md]\ntheme: 7\n");
    expect(await (await request("/api/uistate")).json()).toMatchObject({ recentFiles: ["a.md"] });
    await Bun.write(join(root, ".specquer/user/uistate.yaml"), "{{{ not yaml");
    expect((await request("/api/uistate")).status).toBe(200);
  });

  test("rejects invalid patches", async () => {
    const { request } = await setup({});
    expect((await request("/api/uistate", { method: "PATCH", body: { treePaneFraction: 5 } })).status).toBe(400);
  });
});
