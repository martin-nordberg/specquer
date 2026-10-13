import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { tempRoot } from "../test-support.ts";
import { ftsQuery } from "./query.ts";
import { SEARCH_FILE, SearchIndex, hasFts5 } from "./search-index.ts";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((cleanup) => cleanup()));
  cleanups = [];
});

/** An index over files kept in memory, counting the reads. */
async function setup(files: Record<string, string>) {
  const temp = await tempRoot();
  cleanups.push(temp.cleanup);
  const reads: string[] = [];
  const stamps = new Map(Object.keys(files).map((path) => [path, "1"]));
  const index = new SearchIndex(temp.root, {
    files: async () => Object.keys(files).sort(),
    stamp: async (path) => stamps.get(path),
    read: async (path) => {
      reads.push(path);
      return files[path];
    },
  });
  cleanups.push(async () => index.close());
  const search = (question: string, options: { openFile?: string; units?: number; contextTokens?: number } = {}) =>
    index.search(ftsQuery(question), { units: 8, contextTokens: 12_000, ...options });
  const change = (path: string, text: string) => {
    files[path] = text;
    stamps.set(path, String(Number(stamps.get(path) ?? "0") + 1));
  };
  return { root: temp.root, index, reads, search, change, files };
}

const SPECS = {
  "docs/sections.md": "# Sections\n\nSections have permanent IDs.\n\n## Copies\n\nA copied section gets a new ID when it is renumbered.\n",
  "docs/summaries.md": "# Summaries\n\nSummaries are cached for 60 days.\n\n## Renumbering\n\nUnrelated text about summaries.\n",
  "notes/ideas.md": "Ideas about copied text and other things.\n",
};

test("FTS5 is available in this build", () => {
  expect(hasFts5()).toBe(true);
});

test("finds units by their words, with stemming, and records paths and outline paths", async () => {
  const { search } = await setup({ ...SPECS });
  const found = await search("how are copies renumbered");
  expect(found[0]).toMatchObject({ path: "docs/sections.md", outlinePath: "0.0", title: "Copies", headings: ["Sections"] });
  expect(found.map((unit) => unit.path)).toContain("notes/ideas.md");
});

test("a title match ranks above a body match", async () => {
  const { search } = await setup({
    "a.md": "# Other\n\nThis mentions prefixes once.\n",
    "b.md": "# Prefixes\n\nAbout something.\n",
  });
  expect((await search("prefixes")).map((unit) => unit.path)).toEqual(["b.md", "a.md"]);
});

test("the open file ranks higher, and its first unit is always included", async () => {
  const { search } = await setup({
    "a.md": "# Prefixes\n\nPrefixes prefixes prefixes.\n",
    "b.md": "# Other\n\nOne mention of prefixes.\n",
    "c.md": "# Unrelated\n\nNothing here.\n",
  });
  expect((await search("prefixes", { openFile: "b.md" }))[0]!.path).toBe("b.md");
  const found = await search("prefixes", { openFile: "c.md" });
  expect(found[0]).toMatchObject({ path: "c.md", title: "Unrelated" });
  expect(await search("what is it", { openFile: "c.md" })).toMatchObject([{ path: "c.md" }]);
  expect(await search("what is it")).toEqual([]);
});

test("only changed files are read again; deleted files are dropped", async () => {
  const { index, reads, search, change, files } = await setup({ ...SPECS });
  await index.update();
  expect(reads.sort()).toEqual(Object.keys(SPECS).sort());
  reads.length = 0;
  await index.update();
  expect(reads).toEqual([]);
  change("docs/summaries.md", "# Summaries\n\nNow about bananas.\n");
  delete (files as Record<string, string>)["notes/ideas.md"];
  expect((await search("bananas")).map((unit) => unit.path)).toEqual(["docs/summaries.md"]);
  expect(reads).toEqual(["docs/summaries.md"]);
  expect((await search("ideas copied")).map((unit) => unit.path)).not.toContain("notes/ideas.md");
});

test("the budget limits the units, and long units are cut", async () => {
  const long = `# Long\n\n${"word ".repeat(4000)}needle\n`;
  const { search } = await setup({ "long.md": long, "a.md": "# A\n\nneedle\n", "b.md": "# B\n\nneedle\n" });
  const found = await search("needle word", { units: 2, contextTokens: 2000 });
  expect(found.length).toBeLessThanOrEqual(2);
  const cut = found.find((unit) => unit.path === "long.md");
  expect(cut?.cut).toBe(true);
  expect(cut!.text.length).toBeLessThanOrEqual(1000 * 4);
});

test("anchor IDs come with their units", async () => {
  const { search } = await setup({ "a.md": '<a id="SPEC-00007" data-uid="aaaaaaaaaaaa"></a>\n# Anchored\n\nZebra text.\n' });
  expect(await search("zebra")).toMatchObject([{ anchorId: "SPEC-00007", title: "Anchored" }]);
});

test("a damaged database is moved aside and rebuilt; another schema version is rebuilt", async () => {
  const { root, search } = await setup({ ...SPECS });
  await Bun.write(join(root, SEARCH_FILE), "not a database at all, just text that is long enough to be read as one");
  expect((await search("summaries cached"))[0]!.path).toBe("docs/summaries.md");
  const { root: root2, index: index2, search: search2 } = await setup({ ...SPECS });
  await search2("summaries");
  index2.close();
  const db = new Database(join(root2, SEARCH_FILE));
  db.run("PRAGMA user_version = 99");
  db.close();
  expect((await search2("summaries cached"))[0]!.path).toBe("docs/summaries.md");
});

test("the cache folder gets its .gitignore", async () => {
  const { root, index } = await setup({ ...SPECS });
  await index.update();
  expect(await Bun.file(join(root, ".specquer/cache/.gitignore")).text()).toBe("*\n");
});
