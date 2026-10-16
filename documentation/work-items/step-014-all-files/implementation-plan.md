<a id=""></a>

<a id=""></a>
# Step 014 - Implementation Plan

_Plan for the [All Files requirements](requirements.md). Drafted October 2026._

<a id=""></a>
## 1. Summary

Step 014 adds an **All Files** view to the folder pane and view-only panes for text files, images and other files. It highlights code in Markdown previews, and lists the files once instead of four times per tree load (the code review's P1). Markdown editing is untouched: every route that changes something stays Markdown-only.

Four parts need care:

| Part | Where | Why it matters |
|---|---|---|
| One listing for every consumer | `server/src/listing.ts` (new), `files.ts`, `section-index.ts` | Today the tree, the section scan, the chat index, pre-filling and comment problems each list and `stat` every file. All Files makes listings larger, so this comes first (§4.1, D1) |
| Reading `.specquer/shared/` without opening the rest of `.specquer` | `shared/src/paths/paths.ts`, `files.ts` | `checkPath` refuses every `.specquer` segment, and that keeps the session token's folder out of reach. Only the new view-only routes may read `.specquer/shared/` (§4.2, D3) |
| Highlighting without growing the main bundle | `shared/src/markdown/`, the preview worker | `lowlight`'s grammars are a few hundred kilobytes, and `@specquer/shared/markdown` is imported by the main bundle. The highlighter gets its own subpath, imported only by the worker (§4.4, D4) |
| A second kind of open file | `client/src/app/App.tsx` | `DocumentStore` is all about editing Markdown. A view-only file gets its own small state beside it, rather than a mode inside it (§4.6, D5) |

There are seven phases (§5):

1. listing the files once (R9), on its own;
2. shared foundations;
3. highlighting in the preview pipeline, including Markdown's own code blocks;
4. the server: All Files, the view and image routes, Markdown-only deletes;
5. the client: the selector, the tree and the file views;
6. end-to-end tests;
7. documentation.

Decisions taken while planning are in §6, marked _Proposed_. The work proceeds on them unless they are changed. Three of them change the requirements' wording (§2).

<a id=""></a>
## 2. Precedence

The requirements' Precedence table applies. This plan adds:

| Topic | Requirements | This plan (wins) |
|---|---|---|
| The tree route (R7.1) | `GET /api/tree?view=all` and `view=specs` | One `GET /api/tree` returns both trees, built from one listing, so switching views needs no request (R1.7, R9.5) (D2) |
| Reading other files (R7.2) | `GET /api/file` reads text files too, with a `kind` | `GET /api/file` stays Markdown-only. A new `GET /api/view?path=` returns a file's kind with its text, or why it can't be shown (D5) |
| Refusing changes to other files (R7.4) | `403` | `400`, as the path schemas and `checkRenamedFileName` already answer today. `DELETE /api/entry` gains the same check (D6) |
| Image `ETag` (R8.3) | The file's version | A weak `ETag` from the file's modification time and size, so a revalidation needs no read (D7) |
| `FileService.listFiles`, `listMarkdownFiles` | Each call lists | Gone. Callers take `FileListing.get()` (§4.1) |
| The preview pipeline's entry points | `markdownToHast(markdown)` | Also `createPreviewProcessor({ highlighter })` and `codeFileToHast(text, language)`, which take the highlighter from `@specquer/shared/highlight` (§4.4) |

<a id=""></a>
## 3. Starting Point

- **Listing** (`server/src/files.ts`):
  - `markdownFiles()` runs `gitMarkdownFiles` (`git ls-files --cached --others --exclude-standard` for `*.md`, sidecars, `.specquer-config.yaml` and `.specquer/**`), then `gitUntrackedFolders` and a walk of each untracked folder for empty folders.
  - It then `stat`s every listed path one at a time (`kindOf`), to drop tracked files deleted from disk.
  - Outside Git, `walk()` collects the same kinds of file. `SKIPPED_FOLDERS` is `.git`, `.specquer` and `node_modules`.
- **Callers of the listing:**
  - `getTree`, then, in the background, `sections.scan()` and `filesChanged()`, which updates the chat index and pre-filling, both through `listMarkdownFiles` and a `fileStamp` per file;
  - `SectionIndex.scanFiles` (in `scan`, `save`, `create`, `renumber` and the others that issue IDs), which also re-indexes each sectioned file by stamp, one at a time;
  - `FolderConfigs`;
  - `CommentService.problems`.
- **Path rules** (`shared/src/paths/paths.ts`):
  - `checkPath` refuses any `.git` or `.specquer` segment, in any case. `FileService.assertAllowed` checks the real path the same way.
  - `markdownPathSchema` validates `GET` and `PUT /api/file`, so today neither reads nor writes anything but `.md`.
  - `checkRenamedFileName` refuses renaming a file that isn't Markdown (`400`). `DELETE /api/entry` deletes any entry.
- **Preview** (`shared/src/markdown/preview.ts`):
  - A frozen `processor`: remark-parse, front matter, GFM, remark-rehype, rehype-raw, rehype-sanitize (GitHub's schema, which allows `language-*` classes on `code`), then Specquer's anchor plugins.
  - `client/src/preview/preview-worker.ts` runs `markdownToHast` for `renderer.ts`, which falls back to the main thread where there is no worker (tests).
  - `server/src/preview-worker.ts` builds the worker with `Bun.build`.
  - `Preview.tsx` turns the hast into React with `hast-util-to-jsx-runtime`. Code blocks are styled by the `pre` and `code` rules in `client/src/index.css`, on `bg-muted`.
- **API guard** (`server/src/security.ts`): `apiGuard` checks the session (cookie or bearer) and sets `Cache-Control: no-store` and `nosniff` on every `/api` response after the handler.
- **Client:**
  - `FileTree.tsx` shows `FileText` for every file and gives every entry **Rename…** and **Delete…**.
  - `App.tsx` opens files through `DocumentStore.open` and renders the file pane's header (path, save status, `ViewSwitcher`), `FrontmatterEditor`, `ContentView` and `ConflictDialog`.
  - At start-up it reopens `currentFile` with `docStore.open`, and closes it on failure.
- **UI state** (`shared/src/uistate/uistate.ts`): each field falls back on its own (`.catch`). `UiStateStore` drops a recent or current file that no longer exists.
- **Comments pane:** `CommentsPane` shows "This file can't have comment threads…" when `available` is false. The comments route takes `markdownPathSchema`.

<a id=""></a>
## 4. Proposed Design

<a id=""></a>
### 4.1 Server: One Listing (R9)

- **`server/src/listing.ts`** (new), `FileListing`:
  - `get({ maxAge }): Promise<Listing>`. Concurrent calls share one listing under way. `maxAge: 0` always lists again (tree loads). The scan, the chat index, pre-filling and the view checks pass `LISTING_MAX_AGE = 2_000`.
  - `invalidate()`, called by Specquer's own create, rename, delete, folder settings and anchoring. A save changes no paths, so it doesn't invalidate.
  - A `listings` counter for the test of R9.5.
- **`Listing`**:
  - `all`: every file not excluded by R2.1, sorted;
  - `emptyFolders`;
  - `entries`, for truncation;
  - `nested`: folders below the root holding a `.specquer`;
  - derived once and kept: `markdown`, `configs` and `sidecars` (what `listFiles` returned), filtered from `all`;
  - `has(path)`, a set lookup for the view checks.
- **With Git** (`server/src/git.ts`):
  - `gitAllFiles` replaces `gitMarkdownFiles`: `git ls-files -z --cached --others --exclude-standard`, with no pathspec.
  - `gitDeletedFiles` (`ls-files -z --deleted`) removes tracked files deleted from disk, replacing the `stat` of every file (R9.3).
  - Empty folders come from `gitUntrackedFolders` and the walk, as today.
- **Exclusions**, one function, `hiddenPath(path)` in `shared/src/paths/` (§4.2), applied to Git's output and in the walk:
  - any `node_modules` segment;
  - `.git`;
  - `.specquer/` other than `.specquer/shared/` at the root;
  - every nested `.specquer/` (D3).

  `nested` is still found from Git's output before the filter.
- **Outside Git:** `walk()` collects every file, skipping hidden folders without entering them. `MAX_WALK_ENTRIES` still stops it.
- **Consumers** (they keep the arrays they are given, and don't copy them):
  - `FileService.getTree` becomes `trees(listing)` (§4.3);
  - `SectionIndex.scanFiles`, `FolderConfigs`, `CommentService.problems`;
  - the chat index's and pre-filling's `files()` take `listing.markdown`.
- **Fewer `stat`s:** `SectionIndex.scanFiles` re-indexes with bounded parallelism (`mapLimit(paths, 16, …)`, a small helper in `server/src/limit.ts`). So do the chat index's and pre-filling's stamp checks.
- **Saves don't list (R9.4):**
  - `SectionIndex.save` of a file already in `documents` calls `scanFiles({ listing: "kept" })`. That takes the last listing whatever its age and re-indexes only the saved file. It still loads the data files and folder configuration, which are read again when they change on disk, so IDs are still issued from current counters.
  - A file not yet indexed, and every other operation that issues IDs, keeps the full scan with a 2-second listing.
  - Copies made outside Specquer are found by the next full scan, which every tree load starts (D1).

<a id=""></a>
### 4.2 Shared: Paths, Kinds, Languages, UI State and API

- **`shared/src/paths/paths.ts`:**
  - `hiddenPath(path)` (§4.1).
  - `viewPathSchema`: like `workspacePathSchema`, but a path may start with `.specquer/shared/` (exact case). `checkPath` and every schema that writes stay as they are, so `.specquer/` stays unwritable and `.specquer/user/` unreachable (D3).
  - `FileService.readView` and `imageFile` (§4.3) accept such paths, through a separate `assertViewable(real, path)`: the real path is inside the root, isn't hidden, and is either outside `.specquer` or inside the root's `.specquer/shared/`.
- **`shared/src/paths/kinds.ts`** (new):
  - `fileKind(name)`: `"markdown" | "image" | "text" | "binary"`, for icons and routing (requirements §5.2);
  - `IMAGE_TYPES`: extension to `Content-Type` (R5.1);
  - `KNOWN_BINARY_EXTENSIONS`.
- **`shared/src/markdown/languages.ts`** (new):
  - `languageForFile(name)`: requirements §5.1's table, matching whole names (`Makefile`, `Gemfile`, `bun.lock`) exactly and extensions ignoring case;
  - `LONG_LINE = 10_000`;
  - `hasLongLine(text)`.

  It has no grammar imports, so the client's main bundle can use it.
- **UI state:** `treeView: z.enum(["specs", "all"]).catch("specs")` in `uiStateSchema`, the patch schema and `diffUiState`, and `setTreeView`. Expanded folders, recent files and the current file are unchanged; they already hold any path.
- **API** (`shared/src/api/`):
  - **Tree:** `Tree` becomes `{ specs: TreeView, all: TreeView }`, each `{ root, truncated }`. `TreeFile` gains no fields, since the client works out kinds from names.
  - **`GET /api/view?path=`** (`viewPathSchema`) returns `FileView`:
    - `{ kind: "text", text, size, version }`;
    - `{ kind: "image", size, version }`;
    - `{ kind: "other", size, reason: "binary" | "not_utf8" | "too_large" }`.

    A Markdown path answers `400`, since Markdown opens through `/api/file`. A hidden or missing path answers `404`.
  - **`GET /api/image?path=`** (`viewPathSchema`) returns the image's bytes.
    - The route sets R8.3's headers itself and answers `304` to a matching `If-None-Match`.
    - `apiGuard` is changed to set `no-store` only when the response has no `Cache-Control`, so the image keeps `no-cache`.
  - **Handlers:** `readView(path)` and `image(path)`, which returns `{ bytes, type, etag }` or `{ notModified: true }`.

<a id=""></a>
### 4.3 Server: Trees, Viewing and Markdown-Only Changes

- **Trees** (`files.ts`, `trees(listing)`), with `buildTree` as today:
  - **All Files:** `listing.all` and `emptyFolders`, cut at `MAX_TREE_FILES` files.
  - **Specs:** `listing.markdown` and empty folders, plus folders holding only `.specquer-config.yaml`, exactly as `getTree` builds it today, without `.specquer/`.
  - Each tree is truncated on its own (R1.8).
- **`readView(path)`:**
  1. Checks `listing.has(path)`, with a listing at most 2 seconds old, which keeps everything R2.1 hides out of reach (R8.1). Then `assertViewable`.
  2. Gets the size from `stat`. Over 5 MB, it answers `too_large` without reading (R7.5).
  3. For an image type, answers `image`.
  4. Otherwise reads the bytes. A NUL byte makes it `binary`; a fatal UTF-8 decode failure makes it `not_utf8`. A byte-order mark is stripped from `text` (R3.1).
- **`image(path)`:** the same checks, the type from `IMAGE_TYPES`, `413` over 5 MB, and `415` for another type. The weak `ETag` is `W/"<mtimeMs>-<size>"` (D7).
- **Markdown only (R7.4):** `deleteEntry` refuses a file that isn't Markdown (`400`, "Specquer changes only Markdown files."), as `checkRenamedFileName` does for renames. Folders are unchanged (requirements §7). `PUT /api/file` is already Markdown-only through its schema.
- **The model (R3.6):** nothing changes. The chat index and summaries take `listing.markdown` only.

<a id=""></a>
### 4.4 Shared: Highlighting (R3.2, R4)

- **Dependencies:** `rehype-highlight` and `lowlight` added to `shared` with `bun add --filter @specquer/shared`.
- **`shared/src/markdown/highlight.ts`**, exported as the new subpath `@specquer/shared/highlight`. It is imported only by the preview worker and tests, so the main bundle never pulls in the grammars (D4). It provides:
  - `highlighter`, a `createLowlight(common)` instance;
  - `rehypeCodeHighlight`, which wraps `rehype-highlight` with `{ detect: false }` and that instance. It runs a step before it that:
    - lowercases a code block's `language-*` class, so `TS` finds `ts`;
    - marks blocks with a long line `no-highlight`, which `rehype-highlight` skips (R4.3).
- **The pipeline** (`preview.ts`): `createPreviewProcessor({ highlighter? })`.
  - With a highlighter, `rehypeCodeHighlight` runs after `rehypeRaw` and before `rehypeSanitize`, so whatever it produces is sanitized (R4.4).
  - `markdownToHast` keeps a processor without one, for the main-thread fallback and the server.
- **The sanitizer** (`sanitizeSchema`): `code` keeps `language-*` and gains `hljs`. `span` gains `className` matching `/^hljs(-[\w-]+)?$/`, besides its `data*`.
  - Raw HTML in a Markdown file can then give a span an `hljs-*` class. That only colors text, so it is accepted.
- **`codeFileToHast(text, language, highlighter?)`** (in `highlight.ts`), for text files (R3.2):
  - **No Markdown:** builds the tree directly; the text is never parsed as Markdown.
  - **Structure:** a `div.code-file` holding an `aria-hidden` gutter `pre.code-gutter` and the `pre > code.hljs.language-x` block.
  - **The gutter:** the line numbers as a single text node joined by `\n`. That is one element for the whole file, not one per line, and with `white-space: pre` and the same line height it lines up with the code, which never wraps (D8).
  - **Highlighting:** `highlighter.highlight(language, text).children` inside `code` when there is a language and no long line; otherwise the plain text node.
  - **Sanitizing:** the result passes through `rehype-sanitize` with the same schema.
- **The worker:** `preview-worker.ts` imports `@specquer/shared/highlight` and handles two messages: `{ id, markdown }` with the highlighting processor, and `{ id, code: { text, language } }` with `codeFileToHast`.
  - `PreviewRenderer` gains `renderCode(text, language)`.
  - Its main-thread fallback renders Markdown without highlighting and code as plain text with numbers, through `codeFileToHast` without a highlighter. The function is exported from `@specquer/shared/markdown` too, without grammar imports.
  - `server/src/preview-worker.ts` is unchanged: `Bun.build` bundles the new imports.
- **Colors** (`client/src/theme/palette.ts`): a `code` group for light and dark.
  - **Tokens:** `keyword`, `string`, `number` (also literals), `comment`, `title` (functions, classes), `type` (types, built-ins), `attribute`, `meta`, `variable`, `addition`, `deletion`, and `lineNumber`.
  - **Variables:** emitted as `--code-*` CSS variables.
  - **Tests:** the palette's contrast tests check each one against `muted`, the code block's background, in both modes (R4.5).
  - **CSS:** `client/src/index.css` maps highlight.js's classes to them (`.hljs-keyword, .hljs-selector-tag { color: var(--code-keyword) }`, …) inside the rendered-Markdown scope, and styles `.code-file`:
    - a grid of the gutter and the block;
    - the gutter `position: sticky; left: 0`, `user-select: none`, right-aligned in `--code-line-number`;
    - the block `overflow-x: auto`.

<a id=""></a>
### 4.5 Client: The Selector and the Tree (R1, R2)

- **`client/src/components/TreeViewSwitcher.tsx`:** a radio group like `ViewSwitcher` (same `ToggleGroup`), labeled "Files shown", above the tree in `App.tsx`'s `left`.
- **Showing a view:** `App` holds the `Tree` with both views and shows `tree[ui.treeView]`. Switching views changes UI state only: no request (R1.7). Every place that reloads the tree today reloads both views.
- **`FileTree.tsx`:**
  - **Icons** by `fileKind`: `FileText` (Markdown), `FileCode` (text), `FileImage`, and `File` (binary).
  - **Menus:**
    - A file that isn't Markdown gets no context menu (R2.3).
    - `.specquer` and everything below it get no context menu either, since no write route accepts those paths (D3).
    - Folders and Markdown files keep theirs.
  - **Empty tree:** the empty message depends on the view: "No Markdown files in this folder." or "No files in this folder."
- **Opening:** `onOpenFile` goes to `openAny` (§4.6). Expanded folders stay shared, and the selection follows `currentFile` in either view (R1.5, R1.6).

<a id=""></a>
### 4.6 Client: Viewing Files (R3, R5, R6)

- **`client/src/app/file-view.ts`:** `ViewedFile`:
  - `{ path, kind: "text", text, size }`;
  - `{ path, kind: "image", size, version }`;
  - `{ path, kind: "other", size, reason }`.
- **`openAny(path)`** in `App.tsx` replaces `open` for the tree, recent files and start-up:
  - **Markdown** goes through `open` as today, which also clears `viewed`.
  - **Any other file:**
    1. saves the open document (staying put on a conflict or error, as today);
    2. calls `docStore.close()`;
    3. fetches `/api/view`;
    4. sets `viewed`;
    5. records it with `openFile` in UI state.
  - **Failures:** a `404` shows the open error, and at start-up closes the file, as today.
- **The file pane** renders one of four things:
  - **a Markdown document:** unchanged;
  - **a text file:** `CodeFileView`;
  - **an image:** `ImageView`;
  - **anything else:** `FilePlaceholder`.

  The last three share a header with `FilePath` and recent files, and no save status, `ViewSwitcher` or `FrontmatterEditor` (R3.3, R5.3).
- **`client/src/components/files/`** (new):
  - **`CodeFileView.tsx`:** asks the renderer for `renderCode(text, languageForFile(path))` and renders the hast with `toJsxRuntime`, no components, inside the rendered-Markdown class so it shares the code block's look.
  - **`ImageView.tsx`:**
    - **Source:** `<img src="/api/image?path=…&v=<version>">`. The cookie goes with a same-origin image request, and `v` makes a changed file a new URL.
    - **Fit and actual size:** fitted with `max-width/max-height: 100%`. A button wraps the image, so a click or Enter toggles actual size, and the pane scrolls at actual size.
    - **Background:** a checkerboard of two `--muted` tones.
    - **Details:** the pixel size from `naturalWidth`/`naturalHeight` and the file size.
    - **Errors:** `onError` shows the placeholder with "This image can't be displayed."
  - **`FilePlaceholder.tsx`:** R6's messages, R3.8's and R5.6's "too large" with the size, and the size formatted once by `formatSize`.
- **The Comments pane (R3.7):** `CommentsPane` gets `body: null` and a new `viewOnly` prop while a file other than Markdown is open, and says "Comments are available for Markdown files in sectioned folders." The comment store isn't asked to load threads for it.
- **Chat:** citations still open Markdown files only, through `openAny`.

<a id=""></a>
## 5. Phases

<a id=""></a>
### Phase 1: Listing the Files Once

- §4.1, with the tree still built from `listing.markdown`, so nothing visible changes.
- Tests:
  - `FileListing`: shared concurrent calls, `maxAge`, `invalidate`, deleted tracked files dropped without `stat`;
  - `mapLimit`;
  - R9.5's counts through `createHandlers`: one tree load lists once (the scan, chat index and pre-filling reuse it); a save of an indexed file lists not at all; a save of a new file and a create list once;
  - the existing section, comment and chat tests, unchanged.
- _Done when_ `bun run typecheck` and `bun test` pass, and the code review note marks P1 fixed.

<a id=""></a>
### Phase 2: Shared Foundations

- §4.2: paths and kinds, languages, `treeView`, the API types and schemas with stub handlers.
- Unit tests:
  - `hiddenPath`, including `node_modules` at depth, `.specquer/shared/` kept, and nested `.specquer/` hidden;
  - `viewPathSchema` against `.specquer/user/`, `.SPECQUER/shared/` and `..`;
  - `fileKind` and `languageForFile` for every row of requirements §5.1, whole names and case;
  - `hasLongLine`;
  - `treeView`'s default and an invalid value.
- _Done when_ `bun run typecheck` and `bun test` pass.

<a id=""></a>
### Phase 3: Highlighting

- §4.4, ending with Markdown's code blocks highlighted in Preview and Split (R4.3), shippable on its own.
- Tests:
  - the pipeline with a highlighter: a named language, an alias, `TS`, no info string, `mermaid`, indented code, a long line;
  - the sanitizer keeping `hljs-*` and dropping other classes, including from raw HTML;
  - `codeFileToHast`: the gutter's numbers and `aria-hidden`, a file holding backtick fences and `<script>` shown as text, no language, a long line, a byte-order mark stripped earlier;
  - the main-thread fallback;
  - the palette's new pairs.
- _Done when_ `bun run typecheck` and `bun test` pass, and the worker's bundle size is measured and noted (requirements §9, risk 6).

<a id=""></a>
### Phase 4: The Server

- §4.3, and the `apiGuard` change of §4.2.
- API tests:
  - both trees in and outside a Git work tree: `.gitignore`, nested `node_modules`, `.specquer/shared/` in **All Files** only, `.specquer/user/` and `.specquer/cache/` in neither, truncation per view;
  - `/api/view` for text with CRLF and a byte-order mark, an image, a NUL byte, Latin-1, over 5 MB (no read), Markdown (`400`), an ignored `.env` (`404`), a symbolic link out of the root (`403`);
  - `/api/image`'s headers, `304`, `413`, `415` and `404`;
  - deleting or renaming a file that isn't Markdown (`400`), and a folder holding one (allowed).
- _Done when_ `bun run typecheck` and `bun test` pass.

<a id=""></a>
### Phase 5: The Client

- §4.5 and §4.6.
- Component tests:
  - the selector and `treeView`;
  - switching without a request;
  - shared expanded folders, and the open file surviving a switch;
  - icons, and no menu for files that aren't Markdown or are under `.specquer/`;
  - `openAny` saving first, staying put on a conflict, and moving between a Markdown document and a text file both ways;
  - `CodeFileView` highlighted, with its gutter;
  - `ImageView`'s fit and actual size by click and Enter, details, and decode failure;
  - each placeholder;
  - the Comments pane's message;
  - reopening a text file at start-up.
- _Done when_ `bun run typecheck` and `bun test` pass.

<a id=""></a>
### Phase 6: End-to-End Tests

- `e2e/all-files.spec.ts`:
  - switch to **All Files** and back, with the choice kept after a reload;
  - open a TypeScript file: highlighted, line numbers shown, and a copied selection without them;
  - a fenced `ts` block highlighted in a Markdown file's preview;
  - a file in `.gitignore` neither listed nor readable through `/api/view`;
  - open a PNG (fit, then actual size) and an SVG;
  - open a binary file and see the placeholder;
  - no context menu on a TypeScript file.
- `e2e/fixtures.ts` gains a helper that writes binary files and a `.gitignore` into the temporary repository.
- _Done when_ the suite passes on Chrome and WebKit.

<a id=""></a>
### Phase 7: Documentation

- The specifications in requirements §6, and the requirements' R7.1, R7.2, R7.4 and R8.3 updated for D2, D5, D6 and D7.
- `CLAUDE.md`:
  - `server/src/listing.ts`;
  - `@specquer/shared/highlight` and why only the worker imports it;
  - `shared/src/paths/kinds.ts` and `languages.ts`;
  - `client/src/components/files/`;
  - Step 014 in "Project state".
- An Implementation Status section is added here.
- _Done when_ `bun run typecheck`, `bun test`, `bun run test:e2e` and `docs:build` pass.

<a id=""></a>
## 6. Decisions

_Proposed_. The work proceeds on them unless they are changed:

- **D1. Saves of indexed files trust the last listing** (§4.1). A save re-indexes only its own file. IDs still come from the data files, which are read again when they change on disk, so a save can't issue an ID that is already used. What it can miss is a copy made outside Specquer since the last scan, and the next tree load's scan finds that, as R9.2 accepts.
- **D2. One tree response with both views** (§4.2). Building the second tree from the same listing costs little, and it makes R1.7 and R9.5 true without a cache keyed by view. The response roughly doubles in size, up to two 10,000-file trees.
- **D3. `.specquer/shared/` is readable through the view-only routes only, and nested `.specquer/` folders are hidden** (§4.2). `checkPath` keeps refusing `.specquer`, so no route that writes, renames or deletes can reach it. A nested `.specquer/` belongs to another Specquer, whose `user/` folder holds that instance's token, so it isn't shown at all.
- **D4. The grammars load only in the worker** (§4.4). The main-thread fallback, used in tests and when the worker fails, shows code unhighlighted. That is acceptable, and keeps the main bundle as it is.
- **D5. `/api/view` instead of a wider `/api/file`** (§4.2). `/api/file`, its `markdownPathSchema` and `DocumentStore` stay exactly as they are, so nothing Markdown does can reach a file that isn't Markdown. One request gives the kind, the size and the text, so the client never reads a large file to find it can't show it.
- **D6. `400` for changes to files that aren't Markdown** (§4.3). The path schemas and `checkRenamedFileName` already answer `400`. Changing them to the requirements' `403` would make one refusal answer two ways.
- **D7. A weak `ETag` from the modification time and size** (§4.3). Hashing a 5 MB image on every revalidation would cost more than sending it. The `v` query parameter (§4.6) changes with the file's version, so a changed image is fetched again.
- **D8. The gutter is one text node** (§4.4). One element for all the numbers, not one per line. That keeps requirements §9 risk 1's DOM size down, and copying the code can't pick up numbers.
- **D9. The listing comes first** (Phase 1). It is a fix in its own right (P1), changes nothing visible, and every later phase builds on `FileListing`.
- **D10. Highlighting ships before All Files** (Phase 3). Markdown's code blocks gain from it at once, and the text view then only adds `codeFileToHast` and the gutter.

<a id=""></a>
## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `git ls-files` without a pathspec in a large repository | A slow tree load, and a large listing held in memory | One listing per tree load instead of four; `MAX_TREE_FILES` caps what is sent; the listing holds paths only |
| The worker grows by `lowlight`'s `common` grammars | A slower first preview | Measured in Phase 3; a smaller subset of `common` if needed |
| Re-highlighting every code block as the user types in Split | Preview lag in documents with much code | The worker already runs off the main thread. If measured lag appears, keep each block's highlighted children keyed by language and text |
| `rehype-highlight`'s handling of unknown languages | A warning per block, or a thrown error in a future version | Unknown languages are tested; the wrapper can drop the class first if needed |
| `apiGuard`'s `Cache-Control` change | Another route loses `no-store` by setting its own header | Only the image route sets one; a test checks that other routes keep `no-store` |
| `.specquer/shared/` paths through a second schema | A write route accepting a `.specquer` path by mistake | Only `/api/view` and `/api/image` use `viewPathSchema`; a router test checks that the others refuse such paths |
| Saves not listing (D1) | A copy made outside Specquer goes unnoticed until the next tree load | The next scan reports or renumbers it, as today; tree loads happen on reload |
| Stale view checks (2 seconds) | A file just created outside Specquer answers `404` briefly | Accepted in requirements §7 |

<a id=""></a>
## 8. Implementation Status

Phases 1 to 7 were carried out in October 2026, one commit each. What differs from the plan, or was learned doing it:

1. **Saves still list the files** (D1 reversed, requirements R9.4 rewritten). Two existing tests showed that a save trusting an older listing is unsafe: an agent writes `REQ-00003` into another file, and the save issues `REQ-00003` again; or a pull brings a new file and a new `sections.yaml`, and the save drops the new file's sections from the data file. Every operation that writes the data files lists again. Only the read-only scan, **Section problems**, the lookup by ID, the chat index, pre-filling and the view checks reuse a listing up to 2 seconds old. Without a `stat` per file, the listing is far cheaper than before, which was most of P1's cost.
2. **The listing stayed in `FileService`** (§4.1). `listing(maxAge)` holds the shared listing, and `listFiles` and `listMarkdownFiles` remain as thin wrappers taking a `maxAge`, so their callers barely changed. There is no `listing.ts`; the bounded parallelism is `mapLimit` in `server/src/limit.ts`. `FileService` invalidates the listing itself on create, rename, delete and file writes; `SectionIndex.configChanged()` invalidates it too, since a folder settings write may add a `.specquer-config.yaml`.
3. **Git's listing** is `ls-files --cached --stage`, `--others --exclude-standard` and `--deleted`, run together. The stage modes drop submodules (`160000`) and name the symbolic links (`120000`), the only files still `stat`ed, since one may lead to a folder.
4. **Tests list every time.** `AppConfig.listingMaxAge` (0 in `testApp`) keeps tests that write files and then call the API from seeing an old listing; the listing tests set their own age.
5. **`checkViewPath` accepts the `.specquer/shared` folder itself**, so the walk outside Git can enter it.
6. **The tree's types** are `FolderTree` (`{ root, truncated }`) for one view and `Tree` (`{ specs, all }`) for the response. In **Specs**, empty folders inside `.specquer/shared/` are left out.
7. **The text view** is a flex row of two `pre` elements: the gutter (one text node, `aria-hidden`, sticky) and the code. Only the code element passes through the sanitizer; the wrapper is Specquer's own. CRLF line endings are shown as LF. The preview and the text view share one renderer, `sharedPreviewRenderer()`, moved out of `Preview.tsx`.
8. **`rehype-highlight` and unknown languages:** it records a message on the file and leaves the block plain; it doesn't throw. `lowlight` matches names case-sensitively, hence the lowercasing step.
9. **The worker** grew from 488 KB to 635 KB minified (155 KB to 198 KB gzipped). The main bundle doesn't import the grammars.
10. **Token colors** follow GitHub's light theme, lightened to 0.8 OKLCH lightness for dark mode and nudged to WCAG AA on the code block's background. In dark mode, strings and numbers come out close in hue.
11. **Images** carry `v=<version>` in their URL, so a changed file is a new URL; the server's routes ignore the parameter. The image is a button (`aria-pressed`, "Show at actual size" or "Fit to the pane").
12. **A comment test's locator** for the **All** filter became exact, since **All Files** matches it too.
13. **Tests:** `bun run typecheck` and `bun test` (730) pass. The end-to-end suite passes on Chrome and WebKit (186), including the new `e2e/all-files.spec.ts` and a highlighting test in `views.spec.ts`. One WebKit run failed `sections.spec.ts`'s section ID completion test, which passed on the next run.
