# Markdown Domain Design

The Markdown domain is the code that works on the content of spec files, as opposed to reading and writing them. It lives in `shared/src/markdown/` (`@specquer/shared/markdown`) so the client, a Web Worker and the server can all use it. It has no Bun or DOM dependencies.

## 1. Scope

| Now (Step 001) | Later |
| -------------- | ----- |
| Splitting a file into front matter and body, and joining them | The heading and section tree (for collapsible sections and summaries) |
| Checking front matter for YAML syntax errors | Traceability anchors and links between sections |
| The preview pipeline (Markdown to a sanitized HTML syntax tree) | Rewriting the Markdown syntax tree (renames, link updates) |

Building the section tree was left for a later step (decision D13); the pipeline is the place to add it.

## 2. Front Matter

```ts
splitFrontmatter(text: string): { frontmatter: string | null; body: string; layout: FrontmatterLayout }
joinFrontmatter(frontmatter: string | null, body: string, layout?: FrontmatterLayout): string
```

- Front matter is a block that starts with `---` on the first line and ends at the next line that is `---` (trailing spaces allowed). `frontmatter` is the text between the delimiter lines, without the last line ending; `null` means the file has none. A block that is never closed is body text.
- **Round trip:** `joinFrontmatter(splitFrontmatter(t))` returns `t` byte for byte. The layout records what that needs: the line ending (`\n` or `\r\n`), a byte-order mark, the closing line as written, whether the closing line ends with a line ending, and whether the block was completely empty (`---` directly followed by `---`). Files mixing line endings inside the front matter block are treated as having none, which also round-trips.
- **Adding front matter:** joining non-null front matter with a body from a file that had none produces `---`, the front matter, `---`, then the body, using the body's line ending.
- **Removing front matter:** joining `null` returns the body alone.
- `detectEol`, `toLf` and `fromLf` convert between a file's line endings and the `\n` the editors use.

```ts
checkYaml(frontmatter: string): Array<{ message: string; line?: number }>
```

- Parses with the `yaml` package and reports syntax errors only. There is no schema; the result drives a warning marker and never stops a save.

## 3. Preview Pipeline

```ts
markdownToHast(markdown: string): Root   // hast, the HTML syntax tree
```

The pipeline is a frozen unified processor (decision D3):

| Step | Plugin | Purpose |
| ---- | ------ | ------- |
| 1 | `remark-parse` | Markdown to mdast |
| 2 | `remark-frontmatter` | Recognize YAML front matter |
| 3 | `remark-gfm` | Tables, task lists, strikethrough, autolinks, footnotes |
| 4 | `remark-rehype` (`allowDangerousHtml`) | mdast to hast; front matter is dropped |
| 5 | `rehype-raw` | Parse raw HTML into real elements |
| 6 | `rehype-sanitize` | Remove anything not allowed (decision D15) |
| 7 | Fragment links | Rewrite `#id` links to `#user-content-id` |

- **Sanitize schema:** GitHub's default schema, plus `data-*` attributes on `a` and `span` for traceability anchors (`<a name="r7k2" data-status="draft"></a>`). `id` and `name` values get the `user-content-` prefix against DOM clobbering, so step 7 rewrites in-page links to match. See [Security](security.md) §6.
- **Where it runs:** in the client's Web Worker (`client/src/preview/preview-worker.ts`), which returns the hast tree; the main thread renders it with `hast-util-to-jsx-runtime` and a component map. The map's `a` component opens links to other workspace `.md` files in Specquer. If the worker can't start, the client calls `markdownToHast` on the main thread.
- **Output is data:** the tree is plain objects, so it can cross the worker boundary and could be produced on the server too.

## 4. Editors and the Domain

- The client keeps one copy of the open file: front matter (or `null`) and body, both with `\n` line endings, plus the layout from `splitFrontmatter`.
- The file text for saving is `fromLf(joinFrontmatter(frontmatter, body, layout), eol)`. It is written only if it differs from the text last read or saved, so an unedited file is never rewritten.
- Milkdown (WYSIWYG) serializes Markdown its own way (list markers, table padding, reference links become inline links). Its output replaces the body only after the user edits in it (decision D5).

## 5. Tests

`shared/src/markdown/frontmatter.test.ts` checks the round trip for LF, CRLF, BOM, empty and blank blocks, unterminated blocks, mixed line endings and closing lines at the end of the file. `preview.test.ts` checks GFM output, that front matter is left out, the traceability anchors, and that scripts, event handlers, iframes and `javascript:` links are removed.
