<a id="SPEC-00001" data-uid="zp0zh8v7la11"></a>

<a id="SPEC-00002" data-uid="aktuc2n0mul5"></a>
# Data Architecture

The data Specquer works with: the content of spec files (Markdown), the permanent IDs of the sections of spec files (sections), the per-user state of the interface (UI state), and AI summaries of sections (summaries).

<a id="SPEC-00003" data-uid="d5wru4623ay4"></a>
## 1. Markdown Content

The Markdown domain is the code that works on the content of spec files, as opposed to reading and writing them. It lives in `shared/src/markdown/` (`@specquer/shared/markdown`) so the client, a Web Worker and the server can all use it. It has no Bun or DOM dependencies.

<a id="SPEC-00004" data-uid="y0ccxd7qi8hq"></a>
### 1.1. Scope

| Now (Steps 001 to 008) | Later |
| ---------------------- | ----- |
| Splitting a file into front matter and body, and joining them | Rewriting the Markdown syntax tree (renames, link updates) |
| Checking front matter for YAML syntax errors | Collapsing individual sections |
| The preview pipeline (Markdown to a sanitized HTML syntax tree) | |
| Finding section anchors and the edits that add them (`sections.ts`, see §2) | |
| The heading outline, the summary slider's stops, and summaries in the preview tree (`outline.ts`, `summary-tree.ts`, see §1.5) | |

<a id="SPEC-00005" data-uid="yhgres48khvu"></a>
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

<a id="SPEC-00006" data-uid="ceexvonxkwxf"></a>
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

<a id="SPEC-00007" data-uid="rw9dw5ins0bf"></a>
### 1.4. Editors and the Markdown Domain

- The client keeps one copy of the open file: front matter (or `null`) and body, both with `\n` line endings, plus the layout from `splitFrontmatter`.
- The file text for saving is `fromLf(joinFrontmatter(frontmatter, body, layout), eol)`. It is written only if it differs from the text last read or saved, so an unedited file is never rewritten.
- Milkdown (WYSIWYG) serializes Markdown its own way (list markers, table padding, reference links become inline links). Its output replaces the body only after the user edits in it (decision D5). Raw HTML, including section anchors, survives its round trip unchanged.
- Saving a sectioned file may return edits that add anchors; the client applies them to the body (see §2.7).

<a id="SPEC-00008" data-uid="a1zpzrzeu209"></a>
### 1.5. Outline and Stops

```ts
buildOutline(body): Outline   // { preamble: Range, sections: OutlineSection[], levels: number[] }
OutlineSection = { depth, title, heading: Range, range: Range, lead: Range, children: OutlineSection[] }
```

- The outline comes from the same `remark-parse` tree as `analyzeBody` (§2.2), so only top-level headings count, not those in block quotes or lists. Offsets are body offsets.
- A section's `heading` runs from its section anchor on the line before it, if any, to the end of the heading; its `range` to the next heading of the same or a higher level; its `lead` is the text before its first subsection. `preamble` is the text before the first heading; `levels` the heading levels used, ascending.
- **Stops** (`summaryStopCount`): `levels.length + 2`, or none without headings. Stop `levels.length + 1` is the full text; stop `k` (1 to `levels.length`) summarizes every section at level `levels[k - 1]` or deeper that isn't inside one already summarized; stop 0 the whole document, preamble included (`summarizedAt`, `summaryStopName`).
- Each summarized section has an **outline path**, the indexes of the section and its ancestors from the top (`1.0.2`), which identifies "the same section" across edits (Step 004 decision D5), and the titles of the headings above it.
- **Summaries in the preview** (`summarizeTree`, decision D1): the whole body is rendered once, then the tree's top-level children are filtered by their source offsets. A summarized section keeps its heading (except at stop 0) and the rest of its range becomes one `specquer-summary` element, which the client's component map renders. Rendering once keeps reference links, footnotes and badges working. Top-level headings get `data-outline-path`, so sections without anchors can be scrolled to.

<a id="SPEC-00009" data-uid="sva68cymg7sb"></a>
### 1.6. Tests

`outline.test.ts` checks outlines (skipped and unused levels, a document starting at h2, a preamble, headings in block quotes and lists, anchors before headings, setext headings, a byte-order mark), the stops and what each summarizes, and the filtered preview tree at every stop. `shared/src/markdown/frontmatter.test.ts` checks the round trip for LF, CRLF, BOM, empty and blank blocks, unterminated blocks, mixed line endings and closing lines at the end of the file. `preview.test.ts` checks GFM output, that front matter is left out, the traceability anchors, the section anchors, and that scripts, event handlers, iframes and `javascript:` links are removed. `sections.test.ts` checks finding and adding section anchors.

<a id="SPEC-00010" data-uid="hrvyjtuuo71x"></a>
## 2. Sections

Sections give parts of spec files permanent IDs, as targets for links, traceability and, later, review comments, summaries and metadata. They come from [Step 002](/work-items/step-002-sections/requirements) and its [implementation plan](/work-items/step-002-sections/implementation-plan). [Step 003](/work-items/step-003-section-uids/implementation-plan) put each section's UID in its anchor and made Specquer report conflicts it can't settle by itself; its [analysis](/work-items/step-003-section-uids/section-anchor-conflicts) lists the conflicts that anchors edited outside Specquer can cause.

The code is split by where it runs:

| Package | Module | Contents |
| ------- | ------ | -------- |
| `shared` | `src/sections/` (`@specquer/shared/sections`) | Section ID and UID formats; the section anchor rules for coding agents (`agent-guide.ts`) |
| `shared` | `src/markdown/sections.ts` | Finding sections, stray anchors and merge conflict markers in a body; the edits that add and correct anchors |
| `shared` | `src/markdown/preview.ts` | Marking section anchors in the preview, for badges |
| `server` | `src/sections/folder-config.ts` | The folder configuration: each folder's `.specquer-config.yaml` |
| `server` | `src/sections/prefixes.ts` | The prefix each section's new ID takes |
| `server` | `src/sections/data.ts` | The data files |
| `server` | `src/sections/reconcile.ts` | Reconciliation: the conflict rules, as a pure function |
| `server` | `src/sections/section-index.ts` | `SectionIndex`: the in-memory index, ID allocation, save, create, rename, delete, renumbering a duplicate, problems, **Add section anchors** |
| `server` | `src/sections/agent-guide.ts` | Adding the agent rules to `AGENTS.md` |
| `client` | `src/components/section-editing.ts` | Paste handling and faded section anchors in the text editor |

<a id="SPEC-00011" data-uid="fudl6mu2mzdq"></a>
### 2.1. Model

| Concept | Description |
| ------- | ----------- |
| Section | A whole file (the **root section**), a top-level heading with the content up to the next heading at the same or a higher level, or an item of a sectioned top-level list |
| Section anchor | An empty HTML anchor carrying the section ID and UID: `<a id="REQ-00257" data-uid="k1v2u0xwq8y7"></a>` |
| Section ID | The section's name: a prefix (an upper-case letter and 1 to 4 upper-case letters or digits), a dash and a sequence number of five or more digits: `^[A-Z][A-Z0-9]{1,4}-[0-9]{5,}$`. It appears in URLs and links. Never reused, and never changed except to resolve a duplicate or at the user's request for another prefix (`XYZ-?`) |
| Section UID | The section's identity: a CUID2 in the anchor's `data-uid`, 12 characters long when new (longer ones stay valid). It travels with the text, so copies, moves, edited IDs and restores can be told apart, and future metadata can be keyed by it |
| Document ID | The root section's UID, so a document keeps its identity when moved or renamed outside Specquer. No file records documents by path ([Step 007](/work-items/step-007-no-documents-file/requirements)); `sections.yaml` records the root section under the document ID, with itself as its `documentId` |
| Placeholder | An anchor in a section anchor's place with a blank `id` (`<a id=""></a>`), which asks for an ID in the inherited prefix and a new UID, or with `XYZ-?` (a prefix, a dash and a question mark), which asks for an ID in prefix `XYZ` and keeps its `data-uid`. Any other `id` isn't a section anchor ([Step 008](/work-items/step-008-refactor-settings/requirements)) |
| Stray anchor | An anchor with a section ID that isn't in a section anchor's place (in a block quote, a nested list or an ordinary paragraph, usually because text moved). It no longer marks a section and is reported |
| Known prefix | A prefix that is a folder's `defaultPrefix` or already has a `sections.yaml` |
| Folder type | Baseline, Change, Auxiliary or Non-sectioned (§2.3). The first three are sectioned and, for now, behave alike |

<a id="SPEC-00012" data-uid="c1rykxhrwzmz"></a>
### 2.2. Recognizing Sections

`analyzeBody(body, options)` parses the body (the file without front matter, `\n` line endings) with `remark-parse` and GFM, so headings and anchors in code, block quotes and nested lists are never sections, and returns the sections and the stray anchors; `findSections` returns only the sections. An anchor is an inline HTML open tag `<a … id="…" …>` directly followed by `</a>`; its `data-uid`, if valid, is the section's UID (a blank placeholder's is ignored; an `XYZ-?` placeholder's is kept). Only an anchor whose `id` is a section ID or a placeholder can be a section anchor; a paragraph "holding only an anchor" may hold other anchors too, and its first section anchor counts.

| Section | Recognized as | Missing anchor written as |
| ------- | ------------- | ------------------------- |
| Root | The first block is a paragraph holding only an anchor, unless the heading on the very next line follows it, which makes it that heading's anchor. An anchor whose UID is a document ID (`options.isDocumentUid`: a UID whose `sections.yaml` entry names itself as its `documentId`, or a document ID the index found) is the root anchor regardless; the heading's new anchor then goes between the two, which restores the blank line | `<a id="X" data-uid="D"></a>` (D the document ID) and a blank line, at the start of the body (after a byte-order mark) |
| ATX heading | A paragraph holding only an anchor, as the block directly before a top-level heading (blank lines allowed), or an anchor at the start of the heading's text (`## <a id="X"></a> Title`, which the WYSIWYG editor writes for some headings) | `<a id="X" data-uid="U"></a>` on its own line before the heading, with a blank line above it when the line above isn't blank (or the anchor would join that paragraph). When the block before the heading is a paragraph of other anchors (`<a id="intro"></a>`), at that paragraph's start instead, with nothing between |
| Setext heading | An anchor at the start of the heading's first line (a line above it would become part of the heading) | `<a id="X" data-uid="U"></a> ` at the start of the first line |
| List item | An anchor at the start of the first paragraph of an item of a top-level list; in a task item, after the box. A list is sectioned when at least one item has an anchor (usually a placeholder the user typed) | `<a id="X" data-uid="U"></a> ` before the item's content |

Other `<a id>` and `<a name>` tags are left alone, but one whose `id` is in the section ID format is a stray anchor. A custom anchor such as `<a id="intro"></a>` directly before a heading stays as it is; the heading gets its section anchor at the start of the custom anchor's paragraph. `data-document-id`, written before Step 003, is no longer read.

`anchorEdits(body, sections, plan)` returns the edits (insertions and replacements, sorted, not overlapping) that give every section without an ID its new ID, renumber or restore the sections the plan names, and add or replace UIDs (`data-uid` goes directly after `id`); other attributes of an anchor are kept. Applying them and finding the sections again needs no further edits.

`hasConflictMarkers(body)` is true when the body has a `<<<<<<<` line and a `>>>>>>>` line; a `=======` line alone is a setext underline.

<a id="SPEC-00013" data-uid="qwmbf9l4ymzl"></a>
### 2.3. Configuration

A folder's settings are in a `.specquer-config.yaml` in the folder itself (the root folder's in the root, next to `.specquer/`), with two optional keys:

```yaml
# documentation/specifications/.specquer-config.yaml
folderType: BASELINE  # or CHANGE, AUXILIARY, NONSECTIONED
defaultPrefix: SPEC
```

| Type | `folderType` | Contents |
| --- | --- | --- |
| Baseline Specs | `BASELINE` | The current or intended state of the whole system |
| Change Specs | `CHANGE` | The work for a given task or feature |
| Auxiliary Specs | `AUXILIARY` | Sectioned specs that aren't updated from change specs |
| Non-sectioned Documents | `NONSECTIONED` | Markdown that Specquer doesn't section |

- **Inheritance.** Each key comes from the nearest `.specquer-config.yaml` at or above the folder that sets it, so a subfolder can change only its prefix, and `NONSECTIONED` switches off a folder inside a sectioned one. Without a `folderType` at or above it, a folder isn't sectioned; there is no built-in default.
- **Sectioned files.** A Markdown file is sectioned exactly when its folder has a sectioned type and a `defaultPrefix`, whatever anchors it holds. A sectioned type without a prefix gets a warning in the log, and its files aren't sectioned. There are no per-file settings: a file's own prefix is its root anchor's.
- **Prefixes.** A new section's ID takes the prefix its `XYZ-?` placeholder asks for, or else its parent section's prefix (`sectionPrefixes` in `prefixes.ts`, worked out top-down in one pass): the parent of a heading is the nearest heading above it at a higher level, of a list item the heading holding the list, and of both the root section when there is none. The root section's prefix is its own, or else the folder's `defaultPrefix`. Renumbering keeps a section's own prefix; an ID with an unknown prefix is renumbered into the parent's. So a file moved to another folder keeps its prefix, and changing a folder's prefix affects only new files.
- **Changing a section's prefix.** Replacing only an anchor's `id` with `XYZ-?`, keeping its `data-uid`, gives the section a new ID in `XYZ` and keeps its UID (§2.5). Its subsections keep their IDs; new ones inherit the new prefix.
- **Reading.** Only the folders the tree listing visits are searched (Git's listing, or the walk, with its ignore rules; never `.git` or `node_modules`), on every scan; a file added by hand counts from the next scan. Each file is read with the `yaml` package's document API, and again when its modification time changes. An unreadable file, invalid YAML or an invalid value is reported in the log and ignored, so its folder inherits. Other keys are ignored here and kept by the writers.
- **Turning a folder off** leaves its anchors in its files; its documents are dropped from the data files and their sections retired (§2.5, rule 4), so making it sectioned again restores them with their IDs.
- **Writing.** The folder settings and new folder dialogs (client §3.6, `server/src/settings/folder-settings.ts`) write only the values that differ from the inherited ones, change keys in place and keep comments and other keys, delete a file left with no keys, and create none to hold nothing. The file is reached only through an existing folder inside the root, and never through a symbolic link.

<a id="SPEC-00014" data-uid="bmy8786aswqq"></a>
### 2.4. Data Files

Committed to Git in `.specquer/shared/`, one file per prefix, one entry per line, entries in the order they were added:

```yaml
# .specquer/shared/SPEC/sections.yaml
lastSequence: 257
sections:
  tz4a98xxat96: { id: SPEC-00001, documentId: tz4a98xxat96 }
  k1v2u0xwq8y7: { id: SPEC-00256, documentId: tz4a98xxat96 }
retired:
  m3n4b5v6c7x8: { id: SPEC-00007 }
```

- `sections` holds every live section by UID, the root sections included (keyed by the document ID, which is also their `documentId`). `retired` holds the sections no document holds any more, by UID, with the ID they had: a section restored later (by `git restore`, or a file moved back into a sectioned folder) comes back with its UID and is told apart from its number reused.
- Every entry can be rebuilt from the documents, which carry the UIDs. The files are the last known state, which the rules in §2.5 compare the documents with ("recorded").
- Git merges conflict only where both branches appended entries. When reading, conflict markers are dropped and both sides kept; for `lastSequence` the highest value wins, for entries with the same key the earlier one, and a UID both live and retired is live.
- Invalid entries are skipped and an unreadable file counts as empty (reported in the log); the index is rebuilt from the documents and the file is written with the next change. Nothing here stops the server.
- No file maps documents to paths: such a file only changed when Specquer wrote it, so renames and copies outside Specquer left it out of date and it added noise and merge conflicts to commits.
- Files are written atomically, only when their content changes, and not at all while they would be empty. They are read again when their modification time or size changes, or a prefix folder appears or goes, as after a pull or a branch switch; numbers issued in the running session stay issued.

<a id="SPEC-00015" data-uid="cwls8mo6j18e"></a>
### 2.5. Reconciliation

`reconcile(data, scannedDocuments, knownPrefixes, newUid, requests, { originals, copyRequests })` is a pure function from the data files and the sections found in the documents (each with its ID and UID) to the data files as they should be, the document ID each file holds, the fixes each document's anchors need, and the duplicates and copied documents waiting for the user. A section's identity is its UID; its ID is its name. A document with merge conflict markers is **frozen**: its sections count as present (so they are neither retired nor reused, and raise `lastSequence`), but it gets no fixes and takes no part in settling duplicates.

Documents (keyed by the root anchor's UID):

1. A document without a document ID (its root anchor lost) gets the one its sections' entries record most often as their `documentId`, if no other file holds it, or a new CUID2.
2. A document ID in several files (a whole file copied): the original keeps it, and the others get new IDs as in rule 1, and all their sections are renumbered as copies; a copy never keeps a section ID its original holds. The original is the file `originals` names: where the index last saw the document alone, or the one file Git's index tracks (§2.6). Without one, the files are a **copied document**: like frozen documents they get no fixes, and they are reported until the user renumbers the copy (`copyRequests`); the first by path stands in for the document meanwhile.
3. A document moved keeps its ID wherever it is; nothing records its path.
4. Sections of documents no sectioned file holds (deleted files, and files no longer in a sectioned folder) are retired.

Sections, in this order:

| Found | Meaning | Fix | Told |
| ----- | ------- | --- | ---- |
| An ID with a prefix that isn't known | A typo, or an ID from elsewhere | A new ID in the parent section's prefix (§2.3), and a new UID | Notice |
| An `XYZ-?` placeholder with a UID no other section holds | A request for another prefix | A new ID in `XYZ`, keeping the UID. Once the file is written, the UID's entry moves to the new ID and the old ID is retired under a UID no section holds, so it is never reused and an edited ID isn't put back to it | Notice |
| No UID, or an invalid one | Written by hand or before Step 003 | The UID recorded for this ID in this document (or for this ID), if no other section holds it; or else a new one | — |
| A known UID with another ID | An edited ID | The recorded ID is put back, unless another section now holds it | Notice |
| A retired ID with its retired UID | A restore | The entry moves back from `retired` | — |
| A retired ID with no UID or another UID | Reuse | A new ID and UID | Notice |
| The same ID and UID twice in one document, or in a copied document | A copy | The occurrence recorded for the ID keeps both, or the first; the copy gets a new ID and UID | Notice |
| The same ID and UID in several documents | A copy across documents | None until the user asks; the recorded occurrence keeps the ID meanwhile | Problem: duplicate |
| The same ID with different UIDs | A collision (two branches issued one number) | None until the user asks; the recorded occurrence keeps the ID meanwhile. Renumbering it keeps its UID | Problem: collision |
| The same UID with different IDs | A copied UID | The occurrence with the recorded ID keeps the UID; the others get new UIDs | Notice |
| A section in another document than recorded | A move | Its entry's `documentId` follows it | — |
| A new ID and a new UID | Added elsewhere, on another branch or by hand | An entry, appended | — |

- "Recorded" means the entry in `sections.yaml` (or `retired`). When several entries match, the earliest wins: the one in the occurrence's document with the occurrence's UID, then the one in its document, then the one with its UID; without one, the first occurrence by path and position keeps the ID.
- `requests` names duplicate occurrences the user asked to renumber; asking for the occurrence that keeps the ID hands it to another.
- Entries for UIDs that no document holds are retired; `lastSequence` becomes the highest number known for the prefix: stored, recorded, retired, or found in a document.
- An ID typed in the section ID format is kept, as an ID arriving from another branch would be, unless it is taken, retired or has an unknown prefix; only a placeholder asks Specquer to choose the number. Other renumberings keep the section's prefix.

<a id="SPEC-00016" data-uid="xc6ahefb2ecm"></a>
### 2.6. The Section Index

`SectionIndex` (server) holds the folder configuration, the data files and, for each sectioned document, its path, modification time, found sections, stray anchors and whether it is frozen. All its operations run one at a time.

It also remembers, for this session only, where it last saw each document ID held by one file alone (`lastSeen`, following renames and deletes made in Specquer). When a scan finds several files holding one document ID, that file is the original; failing that, it asks Git once (`git ls-files --cached` on those paths), and the one file Git's index tracks is the original. Outside Git, or with both files tracked or neither, the copy waits for the user.

| Operation | Behavior |
| --------- | -------- |
| Scan | At startup (in the background) and after each tree load. Reads the data files again if they changed on disk, lists the Markdown files and the folder configuration files as the tree does, reads the configuration files that changed, keeps the sectioned Markdown files, parses only files whose modification time or size changed, and reconciles. **Writes nothing**: opening Specquer on a fresh clone or after a branch switch leaves the working tree unchanged. Save, create, renumbering, problems and **Add section anchors** scan first, so they never work from a stale view of files changed outside Specquer (about 50 ms for this repository, 200 ms for 2,000 files with 40,000 sections, when nothing changed) |
| Allocate | In each section's prefix (§2.3): one more than the highest number known for the prefix (including IDs just typed into the text being saved), recorded at once, so a number is never handed out twice, even if the save then fails |
| Save | For a sectioned file: split off the front matter, convert the body to `\n`, reconcile with this text, allocate IDs for sections without one, placeholders and sections to renumber, put back edited IDs, add or replace UIDs, apply the edits, put back the front matter, line endings and byte-order mark, write with the version check, then write the data files. The response carries the edits, relative to the body sent, and notices for what changed beyond adding anchors. A file with merge conflict markers, or one of a copied document, is written as sent, with a notice |
| Create | A new sectioned file starts with its root anchor (a new number, in the prefix chosen in the dialog or else the folder's, and a new document ID) and a blank line. A new folder gets a `.specquer-config.yaml` when the dialog's type or prefix differ from the inherited ones |
| Rename, delete | After the file-system change, paths in the index and in `lastSeen` follow the rename (everything under a renamed folder); a scan then drops what is gone or no longer matches, and the data files are written |
| Renumber | At the user's request, gives one occurrence of a duplicate or collision (named by path, ID and UID) a new ID, rewriting the file as a save would, if it is still at the version the user saw. The edits are relative to the body on disk. For a copied document, renumbers every section of the file the user names as the copy, its root section included |
| Problems | For a folder: nested Specquer folders (folders inside it with a `.specquer` folder of their own, found by the tree listing: Git's listing of `.specquer/` files, or the walk; each is also reported once in the log), copied documents (their paths), duplicates and collisions waiting for the user (every occurrence's path, UID and title, and which keeps the ID), stray anchors (path, ID and line), and frozen files |
| Add section anchors | Scans, then for each sectioned file under the folder whose anchors would change: rewrites it as a save would. A dry run only lists the files. A file changed on disk during the run is read again, never overwritten blindly; frozen files are left alone. On request it also appends the section anchor rules for coding agents to the root folder's `AGENTS.md` (once, between marker comments) |
| Sections of a document, search | For badge tooltips, problems and link completion: ID, UID (`null` for a section renumbered on the next save), kind, title, heading level, and the problem when the ID is also used elsewhere. Titles: the heading text, the first eight words of a list item, the file name for the root section |

Data files are written only by the changes in this table, and then hold the whole reconciled state, including fixes the scans found for other documents.

<a id="SPEC-00017" data-uid="rnh1wrm2w21u"></a>
### 2.7. Client

- **Anchors added on save.** `DocumentStore` keeps the body it sent. When the save returns edits, it builds a CodeMirror `ChangeSet` from them, maps it through the changes typed since (a `ChangeSet` from `@codemirror/merge`'s `diff` of the sent and current body) and applies it. The written text becomes the saved text, so the anchors aren't unsaved changes. Renumbering a duplicate in the open file saves first and applies the server's edits the same way.
- **Text editor.** `CodeEditor` applies a body changed from outside as the minimal changes, so the selection is mapped and the cursor stays put, and outside the undo history (`addToHistory: false`), so undo never removes an assigned anchor (which would retire its number). Section anchors are faded (the muted color, lighter still), never folded or hidden.
- **Paste handling.** A pasted section anchor whose ID the open document holds elsewhere becomes a placeholder (`<a id=""></a>`) in the same transaction. The other pasted IDs are looked up with `GET /api/sections/search`; one that another document holds becomes a placeholder too, outside the undo history. A cut followed by a paste keeps its IDs: the cut removed the original, and opening another file saves the current one first. In the WYSIWYG editor, a ProseMirror `transformPasted` hook does the first check; copies from other documents are left to the server, which reports them.
- **WYSIWYG.** A Milkdown node view for raw HTML nodes shows an anchor's open tag as the badge (its ID as a tooltip) and hides its closing tag; Milkdown still writes the HTML back unchanged. A heading's anchor shows as a badge on the line above the heading. When a save adds anchors, the WYSIWYG editor reloads its content, which moves its cursor to the start.
- **Badges.** The preview pipeline marks the top-level section anchors (`data-section-anchor`) and moves a heading's anchor into the heading; the first block's anchor is the root's unless a heading follows on the very next line (by source position). The preview renders each marked anchor as the invisible anchor (the scroll target) followed by a `SectionBadge`: a focusable button with the favicon, a tooltip with the section ID, the document path and the UID, and a click that copies the section ID. The preview loads the document's sections when its anchors or the saved version change; a badge whose ID is also used elsewhere has a warning ring, and its tooltip names the other occurrences and offers **Renumber this one**.
- **Notices.** After a save or renumbering with notices, a dismissible line under the file path says what changed (a copy renumbered, a prefix changed on request, an edited ID put back, a reused number, a copied UID, a file with conflict markers or a copied document left alone), with a link to **Section problems…**.
- **Section problems.** **Section problems…** in the folder tree's context menu opens a dialog listing a folder's problems. Each occurrence opens its file at the section; duplicates and collisions have **Renumber**, and each file of a copied document **Renumber this copy**.
- **Agent guide.** **Add section anchors** offers, while `AGENTS.md` lacks them, to add the section anchor rules for coding agents; nothing is written there unless the user ticks the box.
- **Completion.** A CodeMirror completion source recognizes `](#…` and `](path#…` and offers sections from `GET /api/sections/search`: of all documents without a path (inserting the path relative to the open file, or nothing for the same file), of that document with one.
- **Links to sections.** A preview link to another document with a fragment opens the document and scrolls the preview to `user-content-<id>` once rendered.

<a id="SPEC-00018" data-uid="pri1xxztpd4f"></a>
### 2.8. Tests

`shared`: `sections/ids.test.ts`, `uids.test.ts`, `agent-guide.test.ts`, `markdown/sections.test.ts` (every recognition rule, UIDs, placeholders and other anchors, the root anchor with a recorded UID, stray anchors, conflict markers, byte-order mark, stability), `markdown/preview.test.ts` (marking and moving anchors). `server`: `sections/folder-config.test.ts` (inheritance, finding and reading the files), `prefixes.test.ts`, `data.test.ts` (layout, retired entries, merge conflicts, damaged files, changes on disk), `reconcile.test.ts` (a test per rule), `sections-api.test.ts` (save, copies, moves, create, rename, delete, queries, the dry run, IDs added outside Specquer, data files changed on disk, edited IDs, copies and collisions, renumbering, retired IDs, conflict markers, stray anchors, the agent guide, prefixes from anchors). `client`: `edits.test.ts`, `document-store.test.ts` (notices, renumbering), `SectionBadge.test.tsx`, `SectionProblems.test.tsx` (problem badges, notices, the problems dialog, the agent guide offer), `section-editing.test.ts` (paste handling in both editors), `section-completion.test.ts`. End to end: `e2e/sections.spec.ts`, `e2e/prefixes.spec.ts`.

<a id="SPEC-00019" data-uid="harzrgdaqt3k"></a>
## 3. UI State

The UI state is the per-user state of the Specquer interface. The client reads and changes it; the server stores it. Its model lives in `shared/src/uistate/` (`@specquer/shared/uistate`) so both sides apply the same rules.

<a id="SPEC-00020" data-uid="igor7lxc2qky"></a>
### 3.1. Storage

- File: `.specquer/user/uistate.yaml` under the root folder, written by the server with `Bun.YAML`, atomically.
- `.specquer/user/` gets a `.gitignore` containing `*` when Specquer creates the folder, so the state is never committed.
- Several tabs or windows may change it; the last write wins.

<a id="SPEC-00021" data-uid="n624876fazjz"></a>
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
    summaryStop?: number,        // the summary slider, as steps from the full text (0 to 7; absent is 0)
  }>,
}
```

All paths are workspace paths: relative to the root, separated by `/`.

<a id="SPEC-00022" data-uid="b5od7dyxstrp"></a>
### 3.3. Parsing

`parseUiState(value)` turns whatever was stored into a valid state:

- Each field falls back to its default on its own, so one damaged field doesn't lose the rest.
- Unknown fields are dropped; non-string paths and duplicates are removed; the recent files are cut to ten; per-file entries that aren't objects are dropped, and an invalid view type becomes `"text"`.
- A file that isn't YAML at all gives the defaults. Specquer never fails to start because of the UI state.

<a id="SPEC-00023" data-uid="z152glza2s7y"></a>
### 3.4. Updates

Every change is a pure function from state to state:

| Function | Effect |
| -------- | ------ |
| `openFile(state, path)` | Makes `path` current; the previous current file moves to the front of the recent files; `path` leaves them |
| `closeFile(state)` | No current file; the previous one joins the recent files |
| `setViewType`, `setFrontmatterHeight`, `setSummaryStop` | Per-file settings; `summaryStopOf(file, stopCount)` turns the stored steps into a stop, clamped to the stops a document has (Step 004 decision D3) |
| `setTheme`, `setTreePaneFraction` (clamped), `setFolderExpanded` | Global settings |
| `renameInUiState(state, from, to)` | Rewrites every entry for `from` and everything inside it: expanded folders, recent files, current file, per-file settings |
| `deleteInUiState(state, path)` | Removes every entry for `path` and everything inside it |
| `pruneMissing(state, kindOf)` | Removes entries for files and folders that no longer exist, for example deleted by a coding agent |
| `diffUiState(a, b)`, `applyUiStatePatch(state, patch)` | The top-level fields that changed, and applying them |

<a id="SPEC-00024" data-uid="fx9bqp14fish"></a>
### 3.5. Client and Server

- **Client:** `UiStateStore` holds the state, applies changes at once and sends the changed top-level fields as a `PATCH` 300 ms later (and at once when the tab is hidden or the page closes). Before a rename or delete it sends pending changes, and afterwards it takes the state the server returns. Creating a file or folder doesn't involve the server's state: the client expands the folder it was created in and opens a new file through ordinary updates.
- **Server:** `UiStateStore` reads the file for every request, applies the change, drops entries for vanished paths and writes the file, one update at a time. Renames and deletes through the API update the state in the same request, after the file-system change, so the old paths can still be matched.

<a id="SPEC-00025" data-uid="ihuj1n0gkbn6"></a>
### 3.6. Versioning

`version` is 1. Fields added since (`summaryStop`) are optional and parsed on their own, so they need no new version. A later incompatible change to the model raises it; `parseUiState` will then migrate older content, and anything it can't migrate falls back to defaults as above.

<a id="SPEC-00026" data-uid="ks2numy77dxy"></a>
## 4. Summaries

AI summaries of heading sections, shown in the preview by the summary slider ([Client Requirements](client-requirements.md) §6.2), and looked up by section ID for other features. The rules both sides share live in `shared/src/summaries/` (`@specquer/shared/summaries`); the model calls in `agent`; the cache, the call queue, the lookup and pre-filling in `server/src/summaries/`. [Step 005](/work-items/step-005-summarization-changes/implementation-plan) added the lookup, pre-filling, keeping summaries while they are used, and showing which model made a summary.

<a id="SPEC-00027" data-uid="f2qwhacxfvuy"></a>
### 4.1. Rules

- **Simplification** (`simplifySectionText`), before a section is summarized or hashed: LF line endings, no trailing whitespace on lines, runs of blank lines collapsed to one, section anchors removed (placeholders and strays included), leading and trailing whitespace removed. Editor settings and anchor metadata then don't change the cache key.
- **Short sections:** fewer than 60 words after simplification (`isShortSection`) are shown as written, without calling the model.
- **Length:** `targetSentences(words)` = about one sentence per 150 words, at least 2 and at most 10.
- **Targets** (`summaryTargets`): every section any stop summarizes, each once, the deepest stop's first and the whole document last, with its text and the headings above it. Pre-filling and the lookup use them, and the preview's requests come from the same ranges of the same body (`summaryBody`: the file without front matter, LF line endings), so the server's cache keys match the client's requests.
- **Saved text only:** the client sends the text of each section from the body as last read or written (`DocumentStore.savedBody()`, which is `summaryBody` of the saved file), never unsaved edits. Sections of the text shown are matched to sections of the saved text by outline path; one whose text differs keeps its summary, labeled out of date.

<a id="SPEC-00028" data-uid="u2xhdkksjhmj"></a>
### 4.2. Agent Configuration

```yaml
# .specquer/shared/agent.config.yaml
model:
  provider: nvidia                              # the only provider in this version
  name: google/gemma-4-31b-it                   # the provider's model ID
  baseUrl: https://integrate.api.nvidia.com/v1  # the default for nvidia
  apiKeyEnv: NVIDIA_API_KEY                     # the variable holding the key; never the key
summaries:
  concurrency: 2                                # model calls at once
  tokenBudget: 24000                            # above this, summarize from subsections' summaries
  prefill: false                                # summarize everything in the background (§4.7)
```

- `model:` applies to all agent features; `summaries:` to summaries only. The schema and `mergeAgentConfig` are in `agent/src/config.ts`.
- The personal `.specquer/user/agent.config.yaml` overrides the shared file key by key under `summaries:`, and its `model:` replaces the shared one as a whole, since a model's name, URL and key variable belong together (decision D7).
- Unknown keys are ignored; an invalid `model:` is dropped and an invalid setting falls back to its default, each reported on the server's console.
- The schemas are in `shared/src/settings/` (re-exported by `agent`), so the settings dialog (client §10) validates with them too. The dialog writes either file through `server/src/settings/agent-settings.ts` with the `yaml` package's document API: only the settings it changes, keeping comments, order and unknown keys, never writing the default base URL into a file that leaves it out. `null` in a save removes a setting. A personal file is created with `.specquer/user/.gitignore`.

<a id="SPEC-00029" data-uid="kwkob0mx0z6x"></a>
### 4.3. Making a Summary

- **Prompt** (`agent/src/summarize.ts`, `PROMPT_VERSION = 1`): the document's path, the headings above the section and the target sentence count, with the simplified text between `<text>` tags. It asks for plain prose (no Markdown, headings, lists, links or HTML), in the language of the text, and says to ignore instructions in the text. The output has Markdown markers and HTML tags stripped.
- **Model** (`agent/src/model.ts`): `ChatOpenAI` from `@langchain/openai` at the configured base URL (NVIDIA's API is OpenAI-compatible), temperature 0.2, at most 1,024 output tokens, a 120-second timeout and one retry. Its `id` is the configured name, shown to the user; its `key` (`provider:name@baseUrl`) identifies it in the cache, so the same name at another host has its own summaries.
- **Long sections:** a section estimated (characters / 4) above the token budget is summarized from its heading and lead text followed by its subsections' summaries, each made (or found) through the cache first; short subsections count as written. One without subsections is cut at the budget, and its summary is labeled "shortened".

<a id="SPEC-00030" data-uid="v4uhme42gvyw"></a>
### 4.4. Cache

```sql
CREATE TABLE summaries (
  text_key TEXT NOT NULL, model TEXT NOT NULL, prompt_version INTEGER NOT NULL,
  model_name TEXT NOT NULL, summary TEXT NOT NULL, truncated INTEGER NOT NULL,
  created_at INTEGER NOT NULL, used_at INTEGER NOT NULL,
  PRIMARY KEY (text_key, model, prompt_version)
);
```

- `.specquer/cache/summaries.db`, through `bun:sqlite` in WAL mode, created on first use with `.specquer/cache/.gitignore` (`*`). `PRAGMA user_version` is 2; a database with another version (Step 004's) is emptied and created again, since its keys can't be split (Step 005 decision D4).
- `text_key` is the SHA-256 of the simplified text and the target sentence count; `model` is the model's key and `model_name` its name. Changing the model or the prompt makes summaries again, and the older ones can still be found for the same text (Step 005 decision D1). The headings and path are in the prompt but not the key.
- Reading an entry, or finding it still needed while pre-filling, sets `used_at`. Entries unused for 60 days are deleted at startup (if the cache exists) and once a day while summarizing (Step 005 decision D2), so summaries survive a branch switch and back, and summaries of text no section has any more lapse.
- **Best entry** (`best`, Step 005 decision D7): the configured model's with the current prompt version, else another model's with the same prompt version, newest first, else one from an older prompt version, newest first.
- A database that can't be opened is moved aside and created again; if that fails too, summaries are made without a cache.

<a id="SPEC-00031" data-uid="n8x5jzlpt0mj"></a>
### 4.5. Request Flow

1. The preview computes the outline of the text shown and the stop; for the saved text, it lists the sections the stop summarizes that aren't short, and tells the client's `SummaryStore` it needs them.
2. The store requests each one it doesn't have (`POST /api/summaries` with `accept: "any"`, one request per section, decision D4), keeps results in memory by path, headings and simplified text, and aborts requests no longer needed. At most three are in flight at once, in document order; the rest wait in the client, where those no longer needed are dropped unsent.
3. The server answers short sections as written and the best cached entry at once; the others go through the call queue, which limits concurrency, shares a call between identical requests, and drops calls nobody waits for that haven't started. A started call runs to the end and is cached, even if its request was aborted. Interactive calls start before waiting background ones, and background calls take at most `concurrency - 1` slots (at least one); an interactive request joining a waiting background call promotes it.
4. A result that isn't `current` (another model's or an older prompt's) is shown, labeled "older model", and the store asks again with `accept: "current"` once the requests the preview needs have gone. The new summary replaces it in place; if that request fails, the older summary stays, with the error and **Retry**.
5. After a save the saved text changes, so the sections whose text changed are requested again; the others are already in memory.

<a id="SPEC-00110" data-uid="gvsjci5zgk4e"></a>
### 4.6. Lookup by Section

`GET /api/summaries/sections/:id` answers with a section's summary from the cache only, never calling a model (Step 005 decision D5), for link previews and reports to come. `SectionIndex.find` gives the section's document, its body and the section; the lookup (`server/src/summaries/lookup.ts`) takes the outline section whose heading holds the anchor (the whole document for a root section), and its target (§4.1), so the summary the slider made is the one found:

- `{ kind: "text", text }`: a short section, or a list item, as written (simplified)
- `{ kind: "summary", summary, model, truncated, current }`: the best cached entry (§4.4); `current` is false for another model's, or for any entry when no model is configured
- `{ kind: "none" }`: nothing cached yet
- `404` for an unknown ID, `400` for anything that isn't a section ID

<a id="SPEC-00111" data-uid="znuayrzpqa42"></a>
### 4.7. Pre-filling

With `summaries.prefill: true`, a model and its key, the server summarizes every target of every Markdown file in the background (`server/src/summaries/prefill.ts`), so the slider finds its summaries made.

- **A pass** goes through the files in tree order. For each, it takes the targets, deepest first, and summarizes them through the cache at background priority, as many at once as the queue's background slots, so a long section's fallback finds its subsections cached. Short sections are skipped, and cached entries are marked used. A file is skipped while its modification stamp and the model are those of its last complete pass.
- **When:** a pass starts 10 seconds after startup, a save, a create, a rename, a delete, **Add section anchors**, or a tree load (which catches changes made outside Specquer). A trigger while a pass runs makes another pass follow it.
- **Rate limits:** a 429 stops the pass at once (calls still waiting are dropped) and pauses pre-filling for one minute, doubling to at most 15 minutes, until a pass completes. Interactive requests report their own 429s as before.
- **Configuration changes:** switching it off, or changing the model, stops the pass and starts again if it is still on. The configuration is read again on each status request (every page load and tab focus) and at the start of each pass.
- **Status:** `GET /api/summaries/status` has `prefill: { enabled, pending }`, the number of sections the current pass has queued or is summarizing.
