import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { FileService } from "./files.ts";
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

interface FolderTreeJson {
  root: { children: Array<{ kind: string; name: string; path: string; children?: unknown[] }> };
  truncated: boolean;
}

interface TreeJson {
  specs: FolderTreeJson;
  all: FolderTreeJson;
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
    expect(flatten(tree.specs.root)).toEqual(["a/", "a/b.md", "B.MD", "z.md"]);
    expect(tree.specs.truncated).toBe(false);
  });

  test("lists folders that hold no files, inside and outside Git", async () => {
    for (const git of [false, true]) {
      const { root, request } = await setup({ "t/a.md": "", "full/notes.txt": "" }, { git });
      for (const folder of ["t/empty", "new/inner", "new/sub/deeper", "node_modules/x"]) await mkdir(join(root, folder), { recursive: true });
      await Bun.write(join(root, "new/sub/b.md"), "");
      const tree = (await (await request("/api/tree")).json()) as TreeJson;
      expect(flatten(tree.specs.root)).toEqual(["new/", "new/inner/", "new/sub/", "new/sub/deeper/", "new/sub/b.md", "t/", "t/empty/", "t/a.md"]);
    }
  });

  test("respects .gitignore in a Git repository", async () => {
    const { root, request } = await setup({ ".gitignore": "build/\nsecret.md\n", "a.md": "", "build/x.md": "", "secret.md": "" }, { git: true });
    await Bun.write(join(root, "new.md"), "untracked but not ignored");
    const tree = (await (await request("/api/tree")).json()) as TreeJson;
    expect(flatten(tree.specs.root)).toEqual(["a.md", "new.md"]);
  });
});

describe("All Files (Step 014)", () => {
  test("the tree lists every file not hidden, in and outside Git; Specs stays Markdown only", async () => {
    for (const git of [false, true]) {
      const { root, request } = await setup(
        {
          ".gitignore": "dist/\n.env\n",
          "src/index.ts": "",
          "docs/a.md": "",
          "docs/logo.png": "",
          ".github/workflows/ci.yml": "",
          "web/node_modules/pkg/index.js": "",
          "node_modules/x/README.md": "",
          ".specquer/shared/REQ/sections.yaml": "",
          ".specquer/user/instance.json": "{}",
          ".specquer/cache/summaries.db": "",
          "dist/out.js": "",
          ".env": "SECRET=1",
        },
        { git },
      );
      await Bun.write(join(root, "src/new.ts"), "untracked");
      const tree = (await (await request("/api/tree")).json()) as TreeJson;
      // Outside Git there is no .gitignore to apply; `web/` holds only `node_modules`
      const shared = [".github/", ".github/workflows/", ".github/workflows/ci.yml", ".specquer/", ".specquer/shared/", ".specquer/shared/REQ/", ".specquer/shared/REQ/sections.yaml"];
      const docs = ["docs/", "docs/a.md", "docs/logo.png", "src/", "src/index.ts", "src/new.ts"];
      expect([git, flatten(tree.all.root)]).toEqual([git, git ? [...shared, ...docs, ".gitignore"] : [...shared, "dist/", "dist/out.js", ...docs, ".env", ".gitignore"]]);
      expect(flatten(tree.specs.root)).toEqual(["docs/", "docs/a.md"]);
      expect(tree.all.truncated).toBe(false);
    }
  });

  test("GET /api/view returns text without its byte-order mark, line endings kept", async () => {
    const { request } = await setup({ "src/a.ts": "\uFEFFconst a = 1;\r\nconst b = 2;\r\n" });
    const view = await (await request("/api/view?path=src/a.ts")).json();
    expect(view).toMatchObject({ kind: "text", path: "src/a.ts", text: "const a = 1;\r\nconst b = 2;\r\n", size: 31 });
  });

  test("GET /api/view says why a file can't be shown, and that an image is one", async () => {
    const { root, request } = await setup({ "x.md": "# X", "logo.svg": "<svg/>" });
    await Bun.write(join(root, "data.bin"), new Uint8Array([1, 2, 0, 3]));
    await Bun.write(join(root, "latin1.txt"), new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    await Bun.write(join(root, "big.log"), new Uint8Array(5 * 1024 * 1024 + 1).fill(0x61));
    const view = async (path: string) => (await request(`/api/view?path=${path}`)).json();
    expect(await view("data.bin")).toEqual({ kind: "other", path: "data.bin", size: 4, reason: "binary" });
    expect(await view("latin1.txt")).toEqual({ kind: "other", path: "latin1.txt", size: 4, reason: "not_utf8" });
    expect(await view("big.log")).toEqual({ kind: "other", path: "big.log", size: 5 * 1024 * 1024 + 1, reason: "too_large" });
    expect(await view("logo.svg")).toMatchObject({ kind: "image", path: "logo.svg", size: 6 });
    expect((await request("/api/view?path=x.md")).status).toBe(400);
  });

  test("GET /api/view reads .specquer/shared/ but nothing hidden, ignored or outside the root", async () => {
    const { root, request } = await setup(
      { ".gitignore": ".env\n", ".env": "SECRET=1", ".specquer/shared/agent.config.yaml": "model: x\n", ".specquer/user/instance.json": "{}", "node_modules/a.js": "" },
      { git: true },
    );
    const outside = await tempRoot({ "secret.txt": "outside" });
    cleanups.push(outside.cleanup);
    await symlink(join(outside.root, "secret.txt"), join(root, "out.txt"));
    expect(await (await request("/api/view?path=.specquer/shared/agent.config.yaml")).json()).toMatchObject({ kind: "text", text: "model: x\n" });
    expect((await request("/api/view?path=.env")).status).toBe(404);
    expect((await request("/api/view?path=node_modules/a.js")).status).toBe(404);
    expect((await request("/api/view?path=.specquer/user/instance.json")).status).toBe(400);
    expect((await request("/api/view?path=out.txt")).status).toBe(403);
  });

  test("GET /api/image serves listed images with strict headers, and revalidates", async () => {
    const { root, request } = await setup({ "logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>", "notes.txt": "x", ".gitignore": "hidden.png\n" }, { git: true });
    await Bun.write(join(root, "big.png"), new Uint8Array(5 * 1024 * 1024 + 1));
    await Bun.write(join(root, "hidden.png"), "x");
    const res = await request("/api/image?path=logo.svg");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(Object.fromEntries(["content-type", "x-content-type-options", "content-security-policy", "content-disposition", "cache-control"].map((name) => [name, res.headers.get(name)]))).toEqual({
      "content-type": "image/svg+xml",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "content-disposition": "inline",
      "cache-control": "no-cache",
    });
    const etag = res.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"\d+-\d+"$/);
    const again = await request("/api/image?path=logo.svg", { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect((await request("/api/image?path=big.png")).status).toBe(413);
    expect((await request("/api/image?path=notes.txt")).status).toBe(415);
    expect((await request("/api/image?path=hidden.png")).status).toBe(404);
    // Other routes keep `no-store`
    expect((await request("/api/view?path=notes.txt")).headers.get("cache-control")).toBe("no-store");
  });

  test("files other than Markdown can't be renamed or deleted; a folder holding them can", async () => {
    const { root, request } = await setup({ "src/a.ts": "", "src/b.md": "" });
    expect((await request("/api/rename", { method: "POST", body: { path: "src/a.ts", newName: "c.ts" } })).status).toBe(400);
    const deleted = await request("/api/entry?path=src/a.ts", { method: "DELETE" });
    expect(deleted.status).toBe(400);
    expect(((await deleted.json()) as { message: string }).message).toBe("Specquer changes only Markdown files.");
    expect(await Bun.file(join(root, "src/a.ts")).exists()).toBe(true);
    expect((await request("/api/rename", { method: "POST", body: { path: "src", newName: "lib" } })).status).toBe(200);
    expect((await request("/api/entry?path=lib", { method: "DELETE" })).status).toBe(200);
    expect(await readdir(root)).not.toContain("lib");
  });
});

describe("the listing (Step 014, R9)", () => {
  test("is shared by callers at the same time and reused while fresh", async () => {
    const temp = await tempRoot({ "a.md": "" });
    cleanups.push(temp.cleanup);
    const files = new FileService(temp.root, { listingMaxAge: 60_000 });
    const [one, two] = await Promise.all([files.listing(), files.listing()]);
    expect(one).toBe(two);
    expect(await files.listing()).toBe(one);
    expect(files.listings).toBe(1);
    // A tree load lists again
    await files.getTree();
    expect(files.listings).toBe(2);
    // Specquer's own changes list again on the next call
    await files.create("", "b.md", "file");
    expect((await files.listing()).markdown).toEqual(["a.md", "b.md"]);
    expect(files.listings).toBe(3);
  });

  test("leaves out tracked files deleted from disk, and links to folders, without a stat of each file", async () => {
    const { root } = await setup({ "a.md": "", "gone.md": "", "docs/x.md": "" }, { git: true });
    await symlink(join(root, "docs"), join(root, "link.md"));
    await Bun.$`git -C ${root} add link.md && git -C ${root} -c user.email=t@t -c user.name=t commit -qm link`.quiet();
    await rm(join(root, "gone.md"));
    const listing = await new FileService(root).listing();
    expect(listing.markdown).toEqual(["a.md", "docs/x.md"]);
    expect(listing.all).toEqual(["a.md", "docs/x.md"]);
  });

  test("one tree load lists once for the tree, the scan and the chat index; saves list once", async () => {
    const temp = await tempRoot({ "docs/.specquer-config.yaml": "folderType: BASELINE\ndefaultPrefix: REQ\n", "docs/a.md": "", "docs/b.md": "# B\n" });
    cleanups.push(temp.cleanup);
    const { files, sections, request } = testApp(temp.root, undefined, undefined, undefined, undefined, 60_000);
    expect((await request("/api/tree")).status).toBe(200);
    // The background scan, then the chat index and pre-filling, take the same listing
    await sections.scan();
    await files.listMarkdownFiles();
    expect(files.listings).toBe(1);
    const file = (await (await request("/api/file?path=docs/a.md")).json()) as { version: string };
    const saved = await request("/api/file?path=docs/a.md", { method: "PUT", body: { text: "# A\n", baseVersion: file.version } });
    expect(saved.status).toBe(200);
    expect(files.listings).toBe(2);
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

  test("won't follow a symbolic link into a protected folder", async () => {
    const { root, request } = await setup({ ".specquer/shared/x.md": "data", ".git/info/y.md": "git" });
    await symlink(join(root, ".specquer", "shared"), join(root, "shared"));
    await symlink(join(root, ".git"), join(root, "repo"));
    expect((await request("/api/file?path=shared/x.md")).status).toBe(403);
    expect((await request("/api/file?path=shared/x.md", { method: "PUT", body: { text: "new", baseVersion: "x" } })).status).toBe(403);
    expect((await request("/api/entry?path=shared/x.md", { method: "DELETE" })).status).toBe(403);
    expect((await request("/api/rename", { method: "POST", body: { path: "repo/info", newName: "gone" } })).status).toBe(403);
    expect((await request("/api/create", { method: "POST", body: { parent: "repo", name: "z.md", kind: "file" } })).status).toBe(403);
    expect(await read(root, ".specquer/shared/x.md")).toBe("data");
    expect(await read(root, ".git/info/y.md")).toBe("git");
  });

  test.each([".GIT", ".Git/info", ".SPECQUER/shared"])("refuses a protected folder in another case: %p", async (path) => {
    const { request } = await setup({ "a.md": "x" });
    expect((await request(`/api/entry?path=${path}`, { method: "DELETE" })).status).toBe(400);
    expect((await request("/api/rename", { method: "POST", body: { path, newName: "x" } })).status).toBe(400);
    expect((await request("/api/create", { method: "POST", body: { parent: path, name: "d", kind: "folder" } })).status).toBe(400);
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

describe("POST /api/create", () => {
  const create = (body: object) => ({ method: "POST", body });

  test("creates an empty file and a folder", async () => {
    const { root, request } = await setup({ "d/a.md": "A" });
    const file = await request("/api/create", create({ parent: "d", name: "new.md", kind: "file" }));
    expect(file.status).toBe(201);
    expect(await file.json()).toEqual({ path: "d/new.md" });
    expect(await read(root, "d/new.md")).toBe("");
    const folder = await request("/api/create", create({ parent: "", name: "notes", kind: "folder" }));
    expect(await folder.json()).toEqual({ path: "notes" });
    expect((await stat(join(root, "notes"))).isDirectory()).toBe(true);
  });

  test("409 when the name is taken, without changing the existing entry", async () => {
    const { root, request } = await setup({ "d/a.md": "A" });
    expect((await request("/api/create", create({ parent: "d", name: "a.md", kind: "file" }))).status).toBe(409);
    expect((await request("/api/create", create({ parent: "d", name: "a.md", kind: "folder" }))).status).toBe(409);
    expect((await request("/api/create", create({ parent: "", name: "d", kind: "file" }))).status).toBe(400);
    expect((await request("/api/create", create({ parent: "", name: "d", kind: "folder" }))).status).toBe(409);
    expect(await read(root, "d/a.md")).toBe("A");
  });

  test.each(["x.txt", "x", "../x.md", "sub/x.md", ".md", ""])("rejects the file name %p", async (name) => {
    const { request } = await setup({});
    expect((await request("/api/create", create({ parent: "", name, kind: "file" }))).status).toBe(400);
  });

  test("refuses protected names, protected or missing parents, and files as parents", async () => {
    const { request } = await setup({ "a.md": "" });
    expect((await request("/api/create", create({ parent: "", name: ".git", kind: "folder" }))).status).toBe(400);
    expect((await request("/api/create", create({ parent: ".specquer", name: "x.md", kind: "file" }))).status).toBe(400);
    expect((await request("/api/create", create({ parent: "missing", name: "x.md", kind: "file" }))).status).toBe(404);
    expect((await request("/api/create", create({ parent: "a.md", name: "x.md", kind: "file" }))).status).toBe(400);
  });

  test("won't create through a symbolic link out of the root", async () => {
    const { root, request } = await setup({});
    const outside = await tempRoot();
    cleanups.push(outside.cleanup);
    await symlink(outside.root, join(root, "link"));
    expect((await request("/api/create", create({ parent: "link", name: "x.md", kind: "file" }))).status).toBe(403);
    expect(await readdir(outside.root)).toEqual([]);
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
