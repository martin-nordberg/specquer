import { expect, test } from "bun:test";
import { ftsQuery, queryTerms } from "./query.ts";

test("terms are lower-case words without stop words, single letters or repeats", () => {
  expect(queryTerms("How are the section IDs of a copied section renumbered?")).toEqual(["section", "ids", "copied", "renumbered"]);
  expect(queryTerms("What's Specquer's prefix?")).toEqual(["specquer", "prefix"]);
  expect(queryTerms("Über naïve Café 42")).toEqual(["über", "naïve", "café", "42"]);
});

test("each term is quoted and joined with OR", () => {
  expect(ftsQuery("folder types")).toBe('"folder" OR "types"');
});

test("FTS5 syntax in a question can't act", () => {
  for (const question of ['"unclosed', "prefix*", "-minus NOT this", "a NEAR(b c)", "title:secret", "(xray AND yak) OR zebra", "foo^bar {baz qux}"]) {
    const query = ftsQuery(question);
    expect(query).toBeDefined();
    expect(query!).toMatch(/^"[^"]+"( OR "[^"]+")*$/);
  }
  expect(ftsQuery('say "hi"')).toBe('"hi"');
});

test("stop words only gives no query; a follow-up adds the previous question's terms", () => {
  expect(ftsQuery("What is it?")).toBeUndefined();
  expect(ftsQuery("And what about deletes?", "How are renames handled?")).toBe('"deletes" OR "renames" OR "handled"');
});
