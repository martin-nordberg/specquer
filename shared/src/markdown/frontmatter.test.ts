import { describe, expect, test } from "bun:test";
import { checkYaml, joinFrontmatter, splitFrontmatter } from "./frontmatter.ts";

const roundTrips = {
  "no front matter": "# Title\n\nBody\n",
  "empty file": "",
  "simple": "---\ntitle: A\ntags: [x]\n---\n# Title\n",
  "CRLF": "---\r\ntitle: A\r\n---\r\n# Title\r\n",
  "empty block": "---\n---\nbody\n",
  "blank line block": "---\n\n---\nbody\n",
  "closing at end of file": "---\na: 1\n---",
  "closing then newline only": "---\na: 1\n---\n",
  "trailing spaces on closing": "---\na: 1\n---  \nbody",
  "BOM": "\uFEFF---\na: 1\n---\nbody\n",
  "unterminated": "---\na: 1\nbody\n",
  "thematic break later": "# T\n\n---\n\nx\n",
  "dashes inside": "---\na: |\n  ----\n---\nbody\n",
  "mixed line endings": "---\r\na: 1\n---\r\nbody\n",
};

describe("split and join round trip byte for byte", () => {
  for (const [name, text] of Object.entries(roundTrips)) {
    test(name, () => {
      const { frontmatter, body, layout } = splitFrontmatter(text);
      expect(joinFrontmatter(frontmatter, body, layout)).toBe(text);
    });
  }
});

test("splits the parts", () => {
  expect(splitFrontmatter("---\ntitle: A\nx: 2\n---\n# T\n")).toMatchObject({ frontmatter: "title: A\nx: 2", body: "# T\n" });
  expect(splitFrontmatter("---\r\ntitle: A\r\n---\r\n# T").frontmatter).toBe("title: A");
  expect(splitFrontmatter("# T\n").frontmatter).toBeNull();
  expect(splitFrontmatter("---\na: 1\nbody\n").frontmatter).toBeNull();
});

test("adding front matter to a file without it", () => {
  const { body, layout } = splitFrontmatter("# T\n");
  expect(joinFrontmatter("title: A", body, layout)).toBe("---\ntitle: A\n---\n# T\n");
  const crlf = splitFrontmatter("# T\r\nx\r\n");
  expect(joinFrontmatter("a: 1", crlf.body, crlf.layout)).toBe("---\r\na: 1\r\n---\r\n# T\r\nx\r\n");
});

test("removing front matter", () => {
  const { body } = splitFrontmatter("---\na: 1\n---\n# T\n");
  expect(joinFrontmatter(null, body)).toBe("# T\n");
});

test("checkYaml reports syntax errors only", () => {
  expect(checkYaml("title: A\ntags: [x, y]")).toEqual([]);
  expect(checkYaml("")).toEqual([]);
  const problems = checkYaml("title: [unclosed\nother: x");
  expect(problems.length).toBeGreaterThan(0);
  expect(problems[0]?.message).toBeString();
});
