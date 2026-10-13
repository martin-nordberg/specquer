import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { findSpecquerRoot } from "./root.ts";
import { tempRoot } from "./test-support.ts";

const { root: base, cleanup } = await tempRoot();
afterAll(cleanup);

let count = 0;
/** A fresh folder `top/a/b/c` with `.specquer/` in the listed subfolders of `top` ("" for top itself). */
async function tree(specquers: string[], files: string[] = []) {
  const top = join(base, `t${++count}`);
  await mkdir(join(top, "a", "b", "c"), { recursive: true });
  for (const folder of specquers) await mkdir(join(top, folder, ".specquer"), { recursive: true });
  for (const file of files) await Bun.write(join(top, file), "");
  return top;
}

// `top` bounds the search as the Git top level would, so folders above the test's own don't count
describe("finding the Specquer root", () => {
  test("none found: the given folder", async () => {
    const top = await tree([]);
    expect(await findSpecquerRoot(join(top, "a/b"), { top })).toEqual({ kind: "given", root: join(top, "a/b") });
  });

  test("in the given folder: the given folder", async () => {
    const top = await tree(["a/b"]);
    expect(await findSpecquerRoot(join(top, "a/b"), { top })).toEqual({ kind: "given", root: join(top, "a/b") });
  });

  test("in the parent or the grandparent: that folder", async () => {
    const top = await tree(["a"]);
    expect(await findSpecquerRoot(join(top, "a/b"), { top })).toEqual({ kind: "parent", root: join(top, "a"), given: join(top, "a/b") });
    expect(await findSpecquerRoot(join(top, "a/b/c"), { top })).toEqual({ kind: "parent", root: join(top, "a"), given: join(top, "a/b/c") });
  });

  test("in the given folder and a parent, or in two parents: nested, innermost first", async () => {
    const top = await tree(["", "a/b"]);
    expect(await findSpecquerRoot(join(top, "a/b"), { top })).toEqual({ kind: "nested", folders: [join(top, "a/b/.specquer"), join(top, ".specquer")] });
    expect(await findSpecquerRoot(join(top, "a/b/c"), { top })).toEqual({ kind: "nested", folders: [join(top, "a/b/.specquer"), join(top, ".specquer")] });
  });

  test("a .specquer file doesn't count; a symbolic link to a folder does", async () => {
    const top = await tree([], ["a/.specquer"]);
    expect((await findSpecquerRoot(join(top, "a/b"), { top })).kind).toBe("given");
    await mkdir(join(top, "real"));
    await symlink(join(top, "real"), join(top, "a/b/.specquer"));
    expect(await findSpecquerRoot(join(top, "a/b/c"), { top })).toEqual({ kind: "parent", root: join(top, "a/b"), given: join(top, "a/b/c") });
  });

  test("the search stops at the Git work tree's top level", async () => {
    const top = await tree([""]);
    await $`git -C ${join(top, "a")} init -q`.quiet();
    // The .specquer/ above the repository belongs to another root
    expect(await findSpecquerRoot(join(top, "a/b"))).toEqual({ kind: "given", root: join(top, "a/b") });
    await mkdir(join(top, "a/.specquer"));
    expect(await findSpecquerRoot(join(top, "a/b"))).toEqual({ kind: "parent", root: join(top, "a"), given: join(top, "a/b") });
  });

  test("outside Git it goes up to the root of the file system", async () => {
    const seen: string[] = [];
    const result = await findSpecquerRoot("/x/y", {
      top: null,
      hasSpecquer: async (folder) => {
        seen.push(folder);
        return folder === "/";
      },
    });
    expect(seen).toEqual(["/x/y", "/x", "/"]);
    expect(result).toEqual({ kind: "parent", root: "/", given: "/x/y" });
  });
});
