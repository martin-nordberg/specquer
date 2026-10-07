# Step 002 - Implementation Plan

_Plan for [Step 002 requirements](requirements.md): section anchors, section and document IDs,
and links to sections. Drafted October 2026._

## 1. Summary

Step 002 gives every section of a sectioned Markdown file a permanent ID. The server keeps two
kinds of committed data files in `.specquer/shared/` (documents and, per prefix, sections), builds
an in-memory index of all sections, inserts and corrects anchors when a file is saved, created or
covered by an explicit **Add section anchors** command, and resolves duplicates and moved files.
The client shows the anchors as badges in the preview, applies anchors inserted on save without
disturbing the cursor, copies a section's ID from its badge, and helps write links to sections
with completion.

The work is split into seven phases. Phase 0 settles the riskiest questions with spikes; three of
the planned checks were already done while planning (§9). Section 6 lists the decisions taken
while planning; they are marked _Proposed_ and the work proceeds on them unless changed. Section 7
lists the few points that need the author's confirmation.

## 2. Precedence and Conflicts

Step 002 takes precedence over Step 001 and the specifications where they conflict:

| Topic | Before | Step 002 (wins) |
|---|---|---|
| Saving | The server writes the text exactly as sent ([server requirements](/specifications/server-requirements) §4) | For sectioned files the server inserts and corrects anchors first and returns the changes |
| New file | Created empty (client requirements §3.2) | A sectioned file starts with its root anchor |
| `.specquer/` | Only `.specquer/user/` (UI state, ignored by Git) | Also `.specquer/shared/` (configuration and data files, committed) |
| Raw `<a id>` anchors | Rendered as invisible anchors by the preview | Section anchors are rendered as badges |
| Preview links | `#id` and relative `.md` links | Also links to a section of another document, which open the document and scroll to the section |

## 3. Starting Point

- **Markdown:** `shared/src/markdown/` has front matter split and join and the preview pipeline (remark-parse, remark-gfm, remark-frontmatter, remark-rehype, rehype-raw, rehype-sanitize). The sanitizer prefixes `id` and `name` with `user-content-` and allows `data-*` on `<a>`, so `<a id="REQ-00001" data-document-id="…">` survives as `<a id="user-content-REQ-00001" data-document-id="…">`. There is no section tree yet (Step 001 decision D13).
- **Files:** `server/src/files.ts` lists Markdown files through `git ls-files` (or a walk outside Git), reads, saves with a version check, creates, renames and deletes. `server/src/uistate-store.ts` shows the pattern for a YAML store updated one request at a time.
- **Client:** `DocumentStore` keeps the open file as front matter and body; `CodeEditor` replaces its whole document when its `value` changes from outside, which loses the cursor; the preview renders hast through `hast-util-to-jsx-runtime` with a component map.
- **Repository:** `.specquer/shared/section-prefixes.config.yaml` exists, with keys for the folders of `documentation/` and no `"**/*"` key, and the Step 002 documents already contain hand-written `WORK-` anchors.

## 4. Proposed Design

### 4.1 Package Responsibilities

| Package | New in Step 002 |
|---|---|
| `shared` | **Section IDs** (`src/sections/`): ID and prefix format, parsing and formatting. **Section finding and anchoring** (`src/markdown/sections.ts`): find root, heading and list item anchors in a body with the Markdown parser; compute the edits that add missing anchors and replace IDs. **Preview** (`src/markdown/preview.ts`): a rehype step that moves a heading's anchor into the heading so the badge sits at its start. Pure and portable, as before |
| `server` | **Configuration** (prefix globs, matched with `Bun.Glob`). **Data files** (`documents.yaml`, `<prefix>/sections.yaml`) with order-preserving, append-only writes. **Section index** (in memory) with reconciliation and ID allocation. Integration with save, create, rename and delete. New API routes |
| `client` | Applying server edits to the open document and editors without losing the cursor. Badges with tooltip and copy menu in the preview. Section ID completion in the text editor. Opening a section link in another document |

The server owns ID allocation, so two browser tabs or a tab and the background scan can never hand
out the same number.

### 4.2 Recognizing Sections

Sections are found in the body (the file without front matter, with `\n` line endings) from the
mdast tree of `remark-parse` with GFM. An **anchor** is an inline `html` node `<a id="…" …>`
followed by `</a>`, in one of the places below. If its `id` isn't in the section ID format (blank
included), it is a **placeholder** and gets a new ID. Verified while planning (§9.1):

| Section | Recognized as |
|---|---|
| Root | The first block of the body is a paragraph holding only an anchor, and the anchor has `data-document-id`. Migration: without `data-document-id`, the same paragraph counts as the root anchor when it isn't the anchor of the heading that follows it (D3) |
| ATX heading | A paragraph holding only an anchor, as the sibling directly before a top-level heading, blank lines allowed (Milkdown adds one) |
| Setext heading | An anchor as the first inline node of a top-level setext heading (a line above it is absorbed into the heading's text) |
| Heading, inline form | An anchor as the first inline node of a top-level ATX heading (`# <a id="X"></a> Title`). Specquer doesn't write this form, but Milkdown produces it from a one-line setext heading (§9.1) |
| List item | An anchor as the first inline node of the first paragraph of an item of a top-level list. In a task item it follows the box, and the paragraph's position includes the box, so the insertion point is taken from the first inline node |

Anchors in code, block quotes and nested lists are ignored and never changed, and so are
`<a id>` tags anywhere else and `<a name>` tags such as the traceability note's. In a section
anchor's place, though, any `<a id>` is a section anchor or a placeholder, so a custom anchor such
as `<a id="intro"></a>` before a heading in a sectioned file gets a section ID.

```ts
interface FoundSection {
  kind: "root" | "heading" | "item";
  id: string | null;            // null: no anchor yet, or a placeholder
  documentId?: string;          // root only
  title: string;                // heading text, first words of the item, or the file name
  insertAt: number;             // body offset where a missing anchor goes
  anchor?: { from: number; to: number };  // the anchor's range when present
}
findSections(body: string): { sections: FoundSection[]; sectionedLists: ListRef[] }

interface BodyEdit { from: number; to: number; insert: string }
anchorEdits(body: string, plan: AnchorPlan): BodyEdit[]  // plan: new IDs, replacements, document ID
```

Edits are insertions (missing anchors, `data-document-id`) and replacements (placeholders,
renumbered IDs).
Formats: root `<a id="X" data-document-id="C"></a>` plus a blank line; ATX heading `<a id="X"></a>`
on the line before; setext heading `<a id="X"></a> ` at the start of its first line; list item
`<a id="X"></a> ` before the content.

### 4.3 Data Files

`.specquer/shared/documents.yaml`:

```yaml
documents:
  tz4a98xxat96iws9zmbrgj3a: { path: documentation/specifications/overview.md }
```

`.specquer/shared/REQ/sections.yaml`:

```yaml
lastSequence: 257
sections:
  k1v2u0xwq8y7z6t5s4r3p2o1: { id: REQ-00256, documentId: tz4a98xxat96iws9zmbrgj3a }
  m9n8b7v6c5x4z3a2s1d0f9g8: { id: REQ-00257, documentId: tz4a98xxat96iws9zmbrgj3a }
```

- One entry per line (flow mappings), new entries appended, so Git merges conflict only where both
  branches appended. The `yaml` package writes this layout and keeps key order; the server adds it
  as a dependency (D4).
- Written atomically, as `uistate.yaml` is, and only by a change the user makes (§4.4). Read with
  the same "invalid content falls back, never stops the server" rule; an unreadable file is
  reported in the log and rebuilt in memory from the documents, and written with the next change.
- `lastSequence` makes numbers permanent. A merge conflict on it is resolved by the server taking
  the highest value it can find (stored, in `sections.yaml`, in the documents).

### 4.4 Section Index and Reconciliation

`SectionIndex` (server) holds, in memory: the configuration, the data files, and for each
sectioned document its path, document ID, sections and modification time.

- **Scan:** at startup (in the background, after the server is listening), after each tree load
  (`GET /api/tree`, which the client calls after its own changes and when it opens), and before
  **Add section anchors**. Files whose modification time hasn't changed aren't parsed again. Files
  come from the same listing as the tree, filtered by the prefix configuration. A scan updates
  the index only and writes no file, documents or data files alike, so opening Specquer on a fresh
  clone or after a branch switch leaves `git status` clean.
- **Reconcile:** the rules in the requirements' Conflict Resolution sections, as a pure function
  from (data files, scanned documents) to (new data files, per-document fix plans). Fix plans
  (new document IDs, renumbered sections) wait in the index until the document is saved or
  covered by **Add section anchors**. The new data files wait too: save, create, rename, delete
  and **Add section anchors** write them whole, including fixes the scan found for other
  documents. Beyond the requirements' rules, reconciliation drops documents that no longer match
  the configuration (and their sections), keeps the ID and CUID2 of a section found in another
  document than recorded (it was moved) and updates its `documentId`, and renumbers IDs whose
  prefix isn't known: neither a configuration value nor a prefix with a `sections.yaml`, so a
  prefix removed from the configuration doesn't renumber IDs already assigned with it.
- **Allocate:** `nextId(prefix)` returns one more than the highest known number and records it
  in `lastSequence` at once, so an ID is never handed out twice even if the save then fails.
- Updates run one at a time, as in `UiStateStore`.
- The configuration file is read again when its modification time changes. Keys are matched last
  to first with `Bun.Glob`; a key ending in `/` matches `key + "**"`. An invalid prefix value is
  reported in the log and its key ignored. The YAML is read with the `yaml` package's document
  API so key order is kept even for keys that look like numbers.

### 4.5 Save, Create, Rename and Delete

- **Save** (`PUT /api/file`): after the version check, if the file is sectioned the server splits
  off the front matter, converts the body to `\n`, computes the anchor edits (missing anchors,
  pending fixes for this document, `data-document-id`), applies them, joins and restores line
  endings and the byte-order mark, writes, and updates the index. The response becomes
  `{ version, edits? }`, `edits` being body edits relative to the body that was sent.
- **Create** (`POST /api/create`, kind `file`): a sectioned file is written with its root anchor
  and a blank line instead of empty, and registered.
- **Rename and delete:** after the file-system change, the index updates paths in
  `documents.yaml` (everything under a renamed folder) or drops the documents and their sections.
- **Add section anchors** (`POST /api/sections/anchor`, body `{ folder, dryRun }`): lists the
  sectioned files under the folder that would change, and with `dryRun: false` rewrites them with
  the same steps as a save. Files changed on disk during the run are re-read, never overwritten
  blindly.

### 4.6 API Additions

| Route | Purpose |
|---|---|
| `PUT /api/file` | Response gains `edits` when anchors were inserted or corrected |
| `GET /api/sections?path=` | The sections of one document (ID, CUID2, kind, title), for badge tooltips |
| `GET /api/sections/search?q=&limit=` | Sections matching an ID or title prefix, across documents, for completion |
| `POST /api/sections/anchor` | **Add section anchors** for a folder, with a dry run that lists the files that would change |

All are defined in `shared` like the existing routes, with Zod schemas.

### 4.7 Client

- **Applying save edits.** `DocumentStore` keeps the body it sent. When a save returns edits, it
  builds them as a CodeMirror `ChangeSet` against the sent body, maps it through the user's
  changes made since (also a `ChangeSet`, from a diff of sent and current body) and applies the
  result outside the undo history (`addToHistory: false`), so undo never removes an assigned
  anchor (which the next save would replace with a new number). The text written becomes
  `savedText`, so the inserted anchors are not unsaved changes.
- **Editors.** `CodeEditor` stops replacing its whole document when `value` changes from outside:
  it applies the minimal changes (from `@codemirror/merge`'s `diff`), so the selection is mapped
  and the cursor stays where it was. The preview simply re-renders; Milkdown per D6.
- **Badges.** A rehype step in the preview pipeline moves a heading's anchor paragraph into the
  heading as its first child. The preview's component map renders an empty `<a>` whose `id` is
  `user-content-<section ID>` as a badge (`SectionBadge`), keeping the anchor itself for
  scrolling. The badge is a focusable button showing the favicon image (`faviconSvg`), with a
  Radix tooltip (section ID, document path, CUID2 from `GET /api/sections`). Clicking it (or
  Enter) copies the section ID and briefly confirms it in the tooltip. There is no **Copy link**
  (D7).
- **Completion.** A CodeMirror completion source on the body editor recognizes a link target
  ending in `#` plus a partial ID (`](path#RE`). With a path, it offers that document's sections;
  without one, sections of all documents, inserting the relative path for other documents. The
  options come from `GET /api/sections/search`, showing the heading text and the document.
- **Section links.** The preview's link component already opens relative `.md` links in
  Specquer; with a `#` part it then scrolls to `user-content-<id>` once the preview has rendered.
- **Command.** **Add section anchors…** in the folder tree's context menu (folders and the empty
  space for the root): a dialog shows the dry run's count and list of files, and the open file is
  saved first.

## 5. Phases

Each phase lists its tasks and what "done" means. Tests are written within each phase.

### Phase 0 - Spikes

1. **Badges in Milkdown** (D6). A Milkdown node view for inline `html` nodes that renders a
   section anchor as a badge and its `</a>` as nothing, and hides a heading's anchor paragraph.
   *Done when* the WYSIWYG view shows badges and an edit there still saves the anchors unchanged,
   or the fallback is chosen.
2. **Applying edits while typing.** Map a `ChangeSet` of server edits through changes typed during
   the save, with `@codemirror/merge`'s `diff` in `CodeEditor`. *Done when* a test types during a
   slow save and the cursor and both sets of changes survive.
3. **CUID2 in the release build.** `@paralleldrive/cuid2` (3.3.0) in the compiled executable.
   *Done when* `bun run build` produces an executable that generates IDs.

### Phase 1 - Section Domain (`shared`)

- Section ID and prefix format, parse and format, with tests (`[A-Z][A-Z0-9]{1,4}`, five or more
  digits).
- `findSections` and `anchorEdits` per §4.2, with tests for every row of the table, task items,
  nested lists, code blocks, block quotes, front matter, CRLF files (through the existing
  `toLf`/`fromLf`), legacy root anchors (D3), placeholders (blank and non-format IDs, in every
  position), and the Milkdown form with a blank line between anchor and heading.
- *Done when* applying `anchorEdits` and finding sections again is stable (a second run produces
  no edits).

### Phase 2 - Data Files and Index (`server`)

- Configuration loading and glob matching (D2).
- `documents.yaml` and `<prefix>/sections.yaml` read and append-only write (§4.3), with the `yaml`
  package.
- `SectionIndex`: scan, modification-time cache, reconcile (pure, with a table of tests for every
  conflict rule, including moved files, copies, merge leftovers, sections moved between
  documents, documents that no longer match the configuration and unknown prefixes), allocation.
- *Done when* the reconciliation tests pass and a scan of this repository's documents builds the
  index without writing any file.

### Phase 3 - Server Integration and API

- Save with anchor edits and the `edits` response; create with a root anchor; rename and delete
  updating the data files; the background scan at startup and on tree loads.
- `GET /api/sections`, `GET /api/sections/search`, `POST /api/sections/anchor`.
- *Done when* API tests cover saving a file without anchors, a copy of a file (duplicates
  renumbered on save), a file moved outside Specquer (path updated, IDs kept), deleting a folder,
  and the dry run.

### Phase 4 - Client: Saving and Badges

- `DocumentStore` and `CodeEditor` changes from §4.7 (Phase 0 spike 2).
- `rehypeSectionAnchors` step and `SectionBadge` (tooltip, copy on click, keyboard focus).
- WYSIWYG per D6.
- *Done when* component tests cover the badge and end-to-end tests show anchors appearing on save
  with the cursor in place, and badges in the preview and split views.

### Phase 5 - Links and Command

- Completion source, section link navigation, the **Add section anchors…** menu item and dialog.
- *Done when* end-to-end tests complete a link to a section of another document, follow it in the
  preview, and run the command on a folder.

### Phase 6 - Documentation

- Link the requirements and this plan in the VitePress sidebar (done while planning).
- A new specification, **Sections Domain Design**, for the model, recognition rules, data files and
  reconciliation; updates to the server and client requirements, information architecture,
  Markdown domain design, security (`.specquer/shared/` writes) and technical architecture (CUID2,
  `yaml` on the server, the index).
- Update `CLAUDE.md` for the new modules.

## 6. Decision Points

Taken while planning; each is _Proposed_ and the work proceeds on it unless changed.

- **D1. Where IDs are allocated.** _Proposed:_ on the server only, during save, create and the
  command. The client never invents IDs, so no two tabs can collide.
- **D2. Glob semantics.** _Proposed:_ `Bun.Glob` on workspace paths; a key ending in `/` means the
  folder and everything in it; keys checked last to first; keys must match Markdown files only.
- **D3. Legacy root anchors** (no `data-document-id`, as in this repository's Step 002 files).
  _Proposed:_ the paragraph holding only an anchor at the start of the body is the root anchor
  unless it is directly followed (no blank line) by a heading. On the next save it gets its
  `data-document-id`.
- **D4. YAML library on the server.** _Proposed:_ the `yaml` package (already used in `shared`) for
  the data files, since it can write one flow mapping per line and keep key order; `Bun.YAML`
  stays for `uistate.yaml`.
- **D5. When the index notices external changes.** _Proposed:_ at startup and on each tree load,
  using modification times; no file watching in this step. Noticing changes never writes files
  (question 6). Re-checking a file when its tab is reactivated is dropped along with inserting
  anchors on open (requirements: viewing never changes a file).
- **D6. WYSIWYG.** _Proposed:_ decided by spike 1. If badges can't be shown, the WYSIWYG view
  keeps working (anchors survive edits, §9.1) but shows the anchors as raw HTML, is labelled
  experimental, and warns before the first edit of a sectioned file.
- **D7. Copy link.** _Decided:_ dropped for now (question 7). A copied link doesn't know where it
  will be pasted, and a root-relative link works on GitHub but not on the VitePress site. The
  badge copies the section ID only; completion in the editor inserts proper relative paths.
- **D8. Titles in completion.** _Proposed:_ the heading text for heading sections, the first eight
  words of a list item, and the file name for a root section; kept in memory only.

## 7. Open Questions

1. **Nested lists.** The answer "nested lists may NOT be treated as sections" is read as: items of
   lists nested inside another list (or inside a block quote) are never sections, and anchors
   there are left alone. Is that the intent, rather than "sectioning a list doesn't section its
   sub-lists"?
   A: Yes, items nested inside another list are never sections
2. **This repository's configuration.** `.specquer/shared/section-prefixes.config.yaml` starts
   with `"**/*": REQ`, so once Step 002 is in use every Markdown file in the repository, including
   `README.md` and `CLAUDE.md`, gets anchors when it is saved. Should the configuration be limited
   to `documentation/` before Specquer is used on this repository?
   A: Fixed the file to remove **/*
3. **Existing hand-written IDs.** The Step 002 documents use the `SEC` prefix, while the
   configuration gives `documentation/work-items/` the `WORK` prefix. The plan keeps existing IDs
   (an ID never changes once assigned) and gives new sections `WORK` IDs, so these files will mix
   prefixes. Is that acceptable, or should `documentation/work-items/step-002-sections/` map to
   `SEC`?
   A: Changed to WORK
4. **Hand-typed IDs and permanent numbers.** To section a list, the user types an anchor with any
   ID in the format. If they type a number that belonged to a deleted section (say `WORK-00003`),
   the rule "a section ID in a document but not in `sections.yaml` gets an entry" accepts it, and
   a retired number is used again. The server can't tell a typed ID from one that arrived by a
   merge from another branch. Should one placeholder be reserved to mean "assign me a number"
   (sequence `00000`, or `<a id="new"></a>`), with every other ID taken as real? A `00000`
   placeholder would collide with the existing root anchor `WORK-00000` in the requirements.
   A: let's use id="(anything that does not match the section ID format, including blank)"
5. **Prefixes not in the configuration.** Should a typed ID with an unconfigured prefix (a typo
   such as `XYZ-00001`, or the old `SEC-` IDs) create `.specquer/shared/XYZ/sections.yaml`, or be
   renumbered with the file's own prefix?
   A: Let's renumber unknown prefix anchors
6. **The background scan writes committed files.** Viewing never changes a document, but the scan
   at startup and on tree loads rewrites `documents.yaml` and `sections.yaml`. So a fresh clone or
   a branch switch followed by simply opening Specquer leaves `git status` dirty, and a branch
   switch can remove entries. Is that acceptable, or should the scan update only the in-memory
   index, with the data files written only on save, create, rename, delete and **Add section
   anchors**?
   A: OK, let's make it a policy to not revise document files on disk unless they are opened and
   changed in some way.
7. **Copy link and the docs site** (D7). A root-relative link such as
   `/documentation/specifications/overview.md#SPEC-00012` works on GitHub, but VitePress reads
   `/documentation/...` as a site path under `/specquer/`, where it doesn't exist. Should **Copy
   link** copy a path relative to the open file (wrong if pasted into another folder), copy only
   the ID, or offer both?
   A: Let's scrap the copy link idea entirely since it has complexity beyond its value for now at least.
8. **Undo after a save.** If the anchors inserted on save go into the editor's undo history, undo
    removes them, and the next save gives those sections new numbers, retiring the old ones.
    _Proposed:_ apply server edits outside the undo history (`addToHistory: false`).
    A: As proposed
9. **Files that stop matching the configuration** (a key removed or changed). Should their
    documents and sections be dropped from the data files while the anchors stay in the files, or
    kept?
    A: Drop non-matching documents and their sections from the YAML data.
10. **Sections moved between documents.** A heading cut from one document and pasted into another
    takes its anchor along. The plan assumes the section keeps its ID and its `documentId` is
    updated. Should the requirements' Section Conflict Resolution state this rule?
    A: Yes, that is the desired behavior, newly enabled with the documentId idea.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Milkdown can't show badges | WYSIWYG shows raw anchors | Spike first (D6); anchors already survive edits (§9.1) |
| Anchors arrive while the user types | Lost keystrokes or a jumping cursor | Edits mapped through typed changes as `ChangeSet`s; minimal changes in `CodeEditor` (spike 2) |
| Merges of `.specquer/shared/` | Conflicts in appended entries and `lastSequence`; duplicate IDs | One entry per line; highest-number rule; duplicate rules renumber on next save |
| A renumbered duplicate breaks links made on the other branch | A link leads to the wrong section or nowhere | The occurrence recorded in `sections.yaml` keeps its ID; link checking is future work |
| Large repositories | Slow startup scan | Background scan, modification-time cache; SQLite later if needed |
| Saving changes more than the user typed | Surprise diffs | Only anchors change, only in sectioned files; the command asks first; viewing and scanning never write |
| A broad configuration (`"**/*"`) | Anchors in files that aren't specs | Question 2; no built-in default |

## 9. Implementation Notes

### 9.1 Checked While Planning

1. **Parsing anchors** (remark-parse with GFM, as in `shared`): an anchor line directly before an
   ATX heading is a paragraph of two inline `html` nodes followed by the heading; before a setext
   heading it becomes part of the heading's text; in list items it is the first inline node of
   the first paragraph, and in task items the paragraph's position includes the box while the
   anchor's own position follows it; anchors in fenced code are code; in a block quote they are
   inside the quote. These results set the rules in §4.2.
2. **Milkdown round trip** (end-to-end, on Step 001's WYSIWYG view): after an edit, every anchor
   (root with `data-document-id`, heading, bullet and task item) is saved unchanged. Milkdown
   shows them as non-editable raw HTML chips, adds a blank line between a heading's anchor and the
   heading, and changes `*` bullets to `-` (known from Step 001). It rewrites a one-line setext
   heading as an ATX heading (`Setext` + `===` became `# Setext`) and keeps the setext form only
   when the heading's text spans lines, so a setext heading with its anchor at the start becomes
   `# <a id="X"></a> Title`, which is why that form is recognized too.
3. **Packages:** `@paralleldrive/cuid2` 3.3.0 (MIT, three dependencies) is available;
   `@codemirror/autocomplete` 6.20.3 is already installed as a dependency of
   `@codemirror/lang-markdown` and becomes a direct dependency of `client`; `@codemirror/merge`
   is added for `diff`.
