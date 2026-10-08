# Data Architecture

The data Specquer works with: the content of spec files (Markdown), the permanent IDs of the sections of spec files (sections), and the per-user state of the interface (UI state).

## 1. Markdown Content

The Markdown domain is the code that works on the content of spec files, as opposed to reading and writing them. It lives in `shared/src/markdown/` (`@specquer/shared/markdown`) so the client, a Web Worker and the server can all use it. It has no Bun or DOM dependencies.

### 1.1. Scope

| Now (Steps 001 and 002) | Later |
| ----------------------- | ----- |
| Splitting a file into front matter and body, and joining them | The heading and section tree (for collapsible sections and summaries) |
| Checking front matter for YAML syntax errors | Rewriting the Markdown syntax tree (renames, link updates) |
| The preview pipeline (Markdown to a sanitized HTML syntax tree) | |
| Finding section anchors and the edits that add them (`sections.ts`, see §2) | |

Building the section tree was left for a later step (Step 001 decision D13); the pipeline is the place to add it.

### 1.2. Front Matter

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

### 1.3. Preview Pipeline

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
| 8 | Section anchors | Mark the top-level section anchors (`data-section-anchor`, with the section's kind) and move a heading's anchor into the heading, so the preview can show badges |

- **Sanitize schema:** GitHub's default schema, plus `data-*` attributes on `a` and `span` for traceability anchors (`<a name="r7k2" data-status="draft"></a>`). `id` and `name` values get the `user-content-` prefix against DOM clobbering, so step 7 rewrites in-page links to match. See [Security](security.md) §6.
- **Where it runs:** in the client's Web Worker (`client/src/preview/preview-worker.ts`), which returns the hast tree; the main thread renders it with `hast-util-to-jsx-runtime` and a component map. The map's `a` component opens links to other workspace `.md` files in Specquer, and renders a marked section anchor as the anchor followed by a badge. If the worker can't start, the client calls `markdownToHast` on the main thread.
- **Output is data:** the tree is plain objects, so it can cross the worker boundary and could be produced on the server too.

### 1.4. Editors and the Markdown Domain

- The client keeps one copy of the open file: front matter (or `null`) and body, both with `\n` line endings, plus the layout from `splitFrontmatter`.
- The file text for saving is `fromLf(joinFrontmatter(frontmatter, body, layout), eol)`. It is written only if it differs from the text last read or saved, so an unedited file is never rewritten.
- Milkdown (WYSIWYG) serializes Markdown its own way (list markers, table padding, reference links become inline links). Its output replaces the body only after the user edits in it (decision D5). Raw HTML, including section anchors, survives its round trip unchanged.
- Saving a sectioned file may return edits that add anchors; the client applies them to the body (see §2.7).

### 1.5. Tests

`shared/src/markdown/frontmatter.test.ts` checks the round trip for LF, CRLF, BOM, empty and blank blocks, unterminated blocks, mixed line endings and closing lines at the end of the file. `preview.test.ts` checks GFM output, that front matter is left out, the traceability anchors, the section anchors, and that scripts, event handlers, iframes and `javascript:` links are removed. `sections.test.ts` checks finding and adding section anchors.

## 2. Sections

Sections give parts of spec files permanent IDs, as targets for links, traceability and, later, review comments, summaries and metadata. They come from [Step 002](/work-items/step-002-sections/requirements) and its [implementation plan](/work-items/step-002-sections/implementation-plan).

The code is split by where it runs:

| Package | Module | Contents |
| ------- | ------ | -------- |
| `shared` | `src/sections/` (`@specquer/shared/sections`) | Section ID format: parse and format |
| `shared` | `src/markdown/sections.ts` | Finding sections and anchors in a body; the edits that add and correct anchors |
| `shared` | `src/markdown/preview.ts` | Marking section anchors in the preview, for badges |
| `server` | `src/sections/config.ts` | The prefix configuration |
| `server` | `src/sections/data.ts` | The data files |
| `server` | `src/sections/reconcile.ts` | Reconciliation: the conflict rules, as a pure function |
| `server` | `src/sections/section-index.ts` | `SectionIndex`: the in-memory index, ID allocation, save, create, rename, delete, **Add section anchors** |

### 2.1. Model

| Concept | Description |
| ------- | ----------- |
| Section | A whole file (the **root section**), a top-level heading with the content up to the next heading at the same or a higher level, or an item of a sectioned top-level list |
| Section anchor | An empty HTML anchor carrying the section ID: `<a id="REQ-00257"></a>` |
| Section ID | A prefix (an upper-case letter and 1 to 4 upper-case letters or digits), a dash and a sequence number of five or more digits: `^[A-Z][A-Z0-9]{1,4}-[0-9]{5,}$`. Never reused, and never changed except to resolve a duplicate |
| Placeholder | An anchor in a section anchor's place whose `id` isn't a section ID, blank included (`<a id=""></a>`). It asks for an ID |
| Document ID | A CUID2 in the root anchor's `data-document-id`, so a document keeps its identity when moved or renamed outside Specquer |
| Section UID | A CUID2 per section, the key of its entry in `sections.yaml`, for future attributes |
| Known prefix | A prefix that is a value in the configuration or already has a `sections.yaml` |

### 2.2. Recognizing Sections

`findSections(body)` parses the body (the file without front matter, `\n` line endings) with `remark-parse` and GFM, so headings and anchors in code, block quotes and nested lists are never sections. An anchor is an inline HTML open tag `<a … id="…" …>` directly followed by `</a>`.

| Section | Recognized as | Missing anchor written as |
| ------- | ------------- | ------------------------- |
| Root | The first block is a paragraph holding only an anchor with a `data-document-id`. Without one (written before document IDs), it is the root anchor unless the heading on the very next line follows it | `<a id="X" data-document-id="C"></a>` and a blank line, at the start of the body (after a byte-order mark) |
| ATX heading | A paragraph holding only an anchor, as the block directly before a top-level heading (blank lines allowed), or an anchor at the start of the heading's text (`## <a id="X"></a> Title`, which the WYSIWYG editor writes for some headings) | `<a id="X"></a>` on its own line before the heading, with a blank line above it when the line above isn't blank (or the anchor would join that paragraph) |
| Setext heading | An anchor at the start of the heading's first line (a line above it would become part of the heading) | `<a id="X"></a> ` at the start of the first line |
| List item | An anchor at the start of the first paragraph of an item of a top-level list; in a task item, after the box. A list is sectioned when at least one item has an anchor (usually a placeholder the user typed) | `<a id="X"></a> ` before the item's content |

Other `<a id>` and `<a name>` tags are left alone. In a section anchor's place, though, any `<a id>` is a section anchor or a placeholder, so a custom anchor such as `<a id="intro"></a>` directly before a heading in a sectioned file gets a section ID.

`anchorEdits(body, sections, plan)` returns the edits (insertions and replacements, sorted, not overlapping) that give every section without an ID its new ID, renumber the sections the plan names, and set the root anchor's document ID; other attributes of an anchor are kept. Applying them and finding the sections again needs no further edits.

### 2.3. Configuration

`.specquer/shared/section-prefixes.config.yaml` maps workspace paths to prefixes:

```yaml
prefixes:
  "documentation/": REQ
  "documentation/notes/": NOTE
  "documentation/notes/ideas.md": IDEA
  "documentation/specifications/": SPEC
```

- A key is a folder, ending in `/`, which covers every file in it and its subfolders, or a file, ending in `.md`. Keys are paths relative to the root folder (the folder holding `.specquer`); a leading `./` is removed, and `./` alone is the root folder. Keys aren't globs.
- A file's prefix comes from the longest key that matches its path, so a file key beats its folder's key and a subfolder's key beats its parent's. The order of the keys doesn't matter. Only Markdown files that match a key are sectioned.
- Without the file nothing is sectioned; there is no built-in default. A user who wants every file sectioned adds the key `./`.
- The file is read with the `yaml` package's document API, and read again when its modification time changes. An invalid key (not ending in `/` or `.md`, with empty, `.` or `..` segments, or holding `*` or `?`), an invalid prefix, and a key that repeats another after normalizing are reported in the log and ignored.
- A file's new sections get the prefix for its current path; a moved file keeps its IDs, so one file can mix prefixes.

### 2.4. Data Files

Committed to Git in `.specquer/shared/`, one entry per line, entries in the order they were added:

```yaml
# .specquer/shared/documents.yaml
documents:
  tz4a98xxat96iws9zmbrgj3a: { path: documentation/specifications/overview.md }
```

```yaml
# .specquer/shared/SPEC/sections.yaml
lastSequence: 257
sections:
  k1v2u0xwq8y7z6t5s4r3p2o1: { id: SPEC-00256, documentId: tz4a98xxat96iws9zmbrgj3a }
```

- Git merges conflict only where both branches appended entries. When reading, conflict markers are dropped and both sides kept; for `lastSequence` the highest value wins, and for entries with the same key the earlier one.
- Invalid entries are skipped and an unreadable file counts as empty (reported in the log); the index is rebuilt from the documents and the file is written with the next change. Nothing here stops the server.
- Files are written atomically, only when their content changes, and not at all while they would be empty.

### 2.5. Reconciliation

`reconcile(data, scannedDocuments, knownPrefixes, newUid)` is a pure function from the data files and the sections found in the documents to the data files as they should be and, for each document, the fixes its anchors need (its document ID, and the sections to renumber).

Documents:

1. A document without a document ID gets the one recorded for its path, if no other file holds it, or a new CUID2.
2. A document ID in several files (a copy): the file at the recorded path keeps it, or else the first by path; the others get new IDs as in rule 1.
3. A document found at another path than recorded was moved; its path is updated.
4. Entries for document IDs that no sectioned file holds (deleted files, and files that no longer match the configuration) are removed, with their sections.

Sections:

1. An ID with a prefix that isn't known is renumbered with the file's prefix.
2. An ID used more than once: the occurrence in the document `sections.yaml` records for it keeps it (the earliest such entry), or else the first by path; within a document, the first occurrence. The others are renumbered.
3. A section found in another document than recorded was moved (a heading cut from one document and pasted into another); it keeps its ID and UID, and its `documentId` is updated.
4. IDs found in documents but not recorded get entries, appended; entries for IDs that no document holds are removed.
5. `lastSequence` becomes the highest number known for the prefix: stored, recorded, or found in a document.

An ID typed in the section ID format is kept, as an ID arriving from another branch would be, even if its number was retired; only a placeholder asks Specquer to choose the number.

### 2.6. The Section Index

`SectionIndex` (server) holds the configuration, the data files and, for each sectioned document, its path, modification time, document ID and found sections. All its operations run one at a time.

| Operation | Behavior |
| --------- | -------- |
| Scan | At startup (in the background) and after each tree load. Lists the Markdown files as the tree does, keeps the sectioned ones, parses only files whose modification time or size changed, and reconciles. **Writes nothing**: opening Specquer on a fresh clone or after a branch switch leaves the working tree unchanged |
| Allocate | One more than the highest number known for the prefix (including IDs just typed into the text being saved), recorded at once, so a number is never handed out twice, even if the save then fails |
| Save | For a sectioned file: split off the front matter, convert the body to `\n`, reconcile with this text, allocate IDs for sections without one, placeholders and sections to renumber, apply the edits, put back the front matter, line endings and byte-order mark, write with the version check, then write the data files. The response carries the edits, relative to the body sent |
| Create | A new sectioned file starts with its root anchor and a blank line |
| Rename, delete | After the file-system change, paths in the index and in `documents.yaml` follow the rename (everything under a renamed folder); a scan then drops what is gone or no longer matches, and the data files are written |
| Add section anchors | Scans, then for each sectioned file under the folder whose anchors would change: rewrites it as a save would. A dry run only lists the files. A file changed on disk during the run is read again, never overwritten blindly |
| Sections of a document, search | For badge tooltips and link completion: ID, UID (`null` for a duplicate waiting to be renumbered), kind, title, heading level. Titles: the heading text, the first eight words of a list item, the file name for the root section |

Data files are written only by the changes in this table, and then hold the whole reconciled state, including fixes the scans found for other documents.

### 2.7. Client

- **Anchors added on save.** `DocumentStore` keeps the body it sent. When the save returns edits, it builds a CodeMirror `ChangeSet` from them, maps it through the changes typed since (a `ChangeSet` from `@codemirror/merge`'s `diff` of the sent and current body) and applies it. The written text becomes the saved text, so the anchors aren't unsaved changes.
- **Text editor.** `CodeEditor` applies a body changed from outside as the minimal changes, so the selection is mapped and the cursor stays put, and outside the undo history (`addToHistory: false`), so undo never removes an assigned anchor (which would retire its number).
- **WYSIWYG.** A Milkdown node view for raw HTML nodes shows an anchor's open tag as the badge (its ID as a tooltip) and hides its closing tag; Milkdown still writes the HTML back unchanged. A heading's anchor shows as a badge on the line above the heading. When a save adds anchors, the WYSIWYG editor reloads its content, which moves its cursor to the start.
- **Badges.** The preview pipeline marks the top-level section anchors (`data-section-anchor`) and moves a heading's anchor into the heading. The preview renders each marked anchor as the invisible anchor (the scroll target) followed by a `SectionBadge`: a focusable button with the favicon, a tooltip with the section ID, the document path and the UID, and a click that copies the section ID.
- **Completion.** A CodeMirror completion source recognizes `](#…` and `](path#…` and offers sections from `GET /api/sections/search`: of all documents without a path (inserting the path relative to the open file, or nothing for the same file), of that document with one.
- **Links to sections.** A preview link to another document with a fragment opens the document and scrolls the preview to `user-content-<id>` once rendered.

### 2.8. Tests

`shared`: `sections/ids.test.ts`, `markdown/sections.test.ts` (every recognition rule, placeholders, legacy root anchors, byte-order mark, stability), `markdown/preview.test.ts` (marking and moving anchors). `server`: `sections/config.test.ts`, `data.test.ts` (layout, merge conflicts, damaged files), `reconcile.test.ts` (a test per rule), `sections-api.test.ts` (save, copies, moves, create, rename, delete, queries, the dry run). `client`: `edits.test.ts`, `document-store.test.ts`, `SectionBadge.test.tsx`, `section-completion.test.ts`. End to end: `e2e/sections.spec.ts`.

## 3. UI State

The UI state is the per-user state of the Specquer interface. The client reads and changes it; the server stores it. Its model lives in `shared/src/uistate/` (`@specquer/shared/uistate`) so both sides apply the same rules.

### 3.1. Storage

- File: `.specquer/user/uistate.yaml` under the root folder, written by the server with `Bun.YAML`, atomically.
- `.specquer/user/` gets a `.gitignore` containing `*` when Specquer creates the folder, so the state is never committed.
- Several tabs or windows may change it; the last write wins.

### 3.2. Model

```ts
UiState = {
  version: 1,
  theme?: "light" | "dark",      // absent until the user chooses; the browser's preference applies
  treePaneFraction: number,      // folder pane width, 0.1 to 0.7 of the window; default 0.25
  expandedFolders: string[],     // workspace paths
  recentFiles: string[],         // most recent first, at most 10, never the current file
  currentFile?: string,          // the open file
  files: Record<string, {        // keyed by workspace path
    viewType: "text" | "split" | "preview" | "wysiwyg",   // default "text"
    frontmatterHeight?: number,  // front matter editor height in pixels
  }>,
}
```

All paths are workspace paths: relative to the root, separated by `/`.

### 3.3. Parsing

`parseUiState(value)` turns whatever was stored into a valid state:

- Each field falls back to its default on its own, so one damaged field doesn't lose the rest.
- Unknown fields are dropped; non-string paths and duplicates are removed; the recent files are cut to ten; per-file entries that aren't objects are dropped, and an invalid view type becomes `"text"`.
- A file that isn't YAML at all gives the defaults. Specquer never fails to start because of the UI state.

### 3.4. Updates

Every change is a pure function from state to state:

| Function | Effect |
| -------- | ------ |
| `openFile(state, path)` | Makes `path` current; the previous current file moves to the front of the recent files; `path` leaves them |
| `closeFile(state)` | No current file; the previous one joins the recent files |
| `setViewType`, `setFrontmatterHeight` | Per-file settings |
| `setTheme`, `setTreePaneFraction` (clamped), `setFolderExpanded` | Global settings |
| `renameInUiState(state, from, to)` | Rewrites every entry for `from` and everything inside it: expanded folders, recent files, current file, per-file settings |
| `deleteInUiState(state, path)` | Removes every entry for `path` and everything inside it |
| `pruneMissing(state, kindOf)` | Removes entries for files and folders that no longer exist, for example deleted by a coding agent |
| `diffUiState(a, b)`, `applyUiStatePatch(state, patch)` | The top-level fields that changed, and applying them |

### 3.5. Client and Server

- **Client:** `UiStateStore` holds the state, applies changes at once and sends the changed top-level fields as a `PATCH` 300 ms later (and at once when the tab is hidden or the page closes). Before a rename or delete it sends pending changes, and afterwards it takes the state the server returns. Creating a file or folder doesn't involve the server's state: the client expands the folder it was created in and opens a new file through ordinary updates.
- **Server:** `UiStateStore` reads the file for every request, applies the change, drops entries for vanished paths and writes the file, one update at a time. Renames and deletes through the API update the state in the same request, after the file-system change, so the old paths can still be matched.

### 3.6. Versioning

`version` is 1. A later change to the model raises it; `parseUiState` will then migrate older content, and anything it can't migrate falls back to defaults as above.
