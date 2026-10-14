<a id=""></a>

<a id=""></a>
# Step 012 - Implementation Plan

_Plan for the [Comment Threads requirements](requirements.md). Drafted October 2026._

<a id=""></a>
## 1. Summary

Step 012 adds comment threads on sections, kept in a `<name>.md.comments.yaml` sidecar beside each document, read and written in a new Comments pane that shares the third pane's place with AI Chat. Sections with threads show a pip in all three views. It also fixes the document's autosave on leaving the window (R9).

Most of the work is new, but it follows patterns that exist. Four parts need care:

| Part | Where | Why it matters |
|---|---|---|
| Sidecar writes as operations on the file as it is on disk | `server/src/comments/` | Saves happen on every blur, and a Git pull may change the file in between. Applying each change by UID to a fresh read keeps both, and only a change to the same comment conflicts (§4.3, D1) |
| Pips and highlights in two editors whose content the user is typing into | `MilkdownEditor.tsx`, `CodeEditor.tsx` | Node views aren't rebuilt when the threads change, and `CodeEditor` reads its extensions once. Both get decorations fed by transactions/effects, not rebuilt components (§4.8, D3) |
| A section's extent | `shared/src/sections/tree.ts` | Highlighting, the pane's "follow the document" and the summary roll-up all need which text belongs to which section, subsections included, in three renderings (§4.1, §4.9) |
| A Milkdown editor without links or images | `client/src/components/comments/CommentEditor.tsx` | The commonmark preset's parser needs the link and image schemas, so they can't simply be left out (§4.7, D5) |

There are seven phases (§5):

1. saving the document when leaving the window (R9), on its own;
2. shared foundations;
3. the server;
4. the client: pane, store and editor;
5. the client: pips, highlighting, following and F8 in the three views;
6. end-to-end tests;
7. documentation.

Decisions taken while planning are in §6, marked _Proposed_; the work proceeds on them unless they are changed.

<a id=""></a>
## 2. Precedence

The requirements' Precedence table applies. This plan adds:

| Topic | Before | Step 012 (wins) |
|---|---|---|
| UI state's side pane | `chatOpen: boolean` | `sidePane: "chat" \| "comments" \| null`, read from `chatOpen` when absent; also `commentsPaneFraction` and `commentFilter` (§4.6) |
| `PaneLayout`'s right pane | The chat pane, open or not | One right pane with its own width per kind (§4.6) |
| Scrolling to a section | The preview only (`ScrollTarget`) | Also the text and WYSIWYG views, by UID (§4.10) |
| `DocumentStore.save` | Saves the text it holds | First asks the views to hand over pending edits (§4.5) |
| `CodeEditor` | Extensions read once, no outside handle | An `onView` callback, so stable extensions can be fed with effects (§4.8) |
| Git listing (`gitMarkdownFiles`) and the walk in `files.ts` | Markdown and folder configuration files | Also `*.md.comments.yaml` (§4.4) |

<a id=""></a>
## 3. Starting Point

- **Autosave** (`client/src/app/App.tsx`): saves on `visibilitychange` to hidden and on `pagehide` (both `keepalive`), and every 60 seconds; `DocumentStore.save` queues saves and writes only when the text differs from what was saved. The plain text editor reports each change at once (`EditorView.updateListener`). The WYSIWYG view reports through Milkdown's `listener` plugin, whose `markdownUpdated` is debounced by a hard-coded 200 ms.
- **UI state** (`shared/src/uistate/uistate.ts`): every field falls back to its default on its own; the patch schema is partial. `chatOpen` and `chatPaneFraction` came with Step 010.
- **Panes** (`client/src/components/PaneLayout.tsx`): folders | file | chat, the chat pane optional, with its own resizer and limits. `App.tsx` renders `ChatToggle` and `ThemeToggle` in the header.
- **Chat** (`client/src/app/chat-store.ts`, `client/src/components/chat/`): a store with `subscribe`/`get` used through `useSyncExternalStore`; the pane and its answer rendering. `shared/src/markdown/answer.ts` is a narrow Markdown pipeline (no raw HTML, only listed links) rendered to hast.
- **API** (`shared/src/api/router.ts`): `createApiRouter(handlers)` with Zod-validated routes; `server/src/app.ts` implements `ApiHandlers`. `rename` calls `files.rename` then `sections.renamed`; `deleteEntry` and `deletePreview` go through `files.ts`; `create` goes through `SectionIndex.create`.
- **Problems**: `SectionProblem` is a union in `shared/src/api/schemas.ts`; `SectionIndex.problems(folder)` builds the list; `ProblemsDialog.describe` switches on `kind`.
- **Sections** (`shared/src/markdown/sections.ts`, `shared/src/sections/tree.ts`): `analyzeBody` gives `FoundSection`s in document order with their anchors (offsets, `line`), titles, depth and, for list items, their range; `sectionParents` gives each one's parent. There is no section end for headings.
- **UIDs**: `server/src/sections/section-index.ts` issues them with CUID2's `init({ length: UID_LENGTH })`; `UID_PATTERN` is in `shared/src/sections/uids.ts`.
- **Git** (`server/src/git.ts`): helpers run `git -C <root>` through `Bun.$`. Nothing reads `user.name` yet.
- **Badges**:
  - Preview: `Preview.tsx`'s `Link` component (kept stable, reading from a ref) renders `SectionBadge` for each anchor; `SectionMenu` holds the menu items.
  - WYSIWYG: `sectionAnchorView` in `MilkdownEditor.tsx`, a node view built once per anchor node; it stops ProseMirror's mouse handling on the badge.
  - Text: anchors are plain text; there is no gutter.
- **Summary slider**: preview only. `summarizedAt` gives the summarized ranges for a stop; `summarizeTree` replaces their top-level hast children, so anchors inside them aren't rendered.
- **Scrolling to a section**: `ScrollTarget` (`sectionId` or `outlinePath`) is handled by the preview only.

<a id=""></a>
## 4. Proposed Design

<a id=""></a>
### 4.1 Shared: Comments, Extents and Rendering

- **`shared/src/comments/`** (new subpath export `@specquer/shared/comments`):
  - `sidecarSchema` (Zod), matching R3.2: `threads[]` of `{ threadUid, sectionUid, status: "Open" | "Resolved", statusChangedBy?, statusChangedAt?, comments[] }`, each comment `{ commentUid, createdBy, createdAt, updatedBy?, updatedAt?, text }`. Times are ISO 8601 UTC strings. `checkSidecar(value)` adds the checks Zod can't: repeated UIDs, a thread without comments, `updatedBy` without `updatedAt`.
  - `sidecarPath(docPath)` and `documentOfSidecar(path)` (`a.md` ↔ `a.md.comments.yaml`, case kept).
  - API types: `CommentView` (a comment plus `version`, §4.3), `ThreadView`, `CommentsResponse` (`{ available: boolean, threads, unusable?: string }`), and `CommentChange`, a discriminated union: `add-thread`, `reply`, `edit`, `delete-comment`, `set-status`, `delete-thread`.
  - `CommentFilter = "open" | "resolved" | "all"` and `shownBy(filter, thread)`.
- **Extents** (`shared/src/sections/tree.ts`): `sectionExtents(sections, bodyLength): Range[]`. A section's extent starts at its anchor (or its `insertAt` when it has none) and runs to the start of the first later section that isn't one of its descendants, or the end of the body; a list item's ends with its `range`. Sections are in document order, so descendants are contiguous. `descendantsOf(parents, index)` gives the indexes for "subsections included" (R6.1).
- **Comment Markdown** (`shared/src/markdown/comment.ts`): like `answer.ts`, remark-parse with GFM, then:
  - every `link`, `linkReference` and GFM autolink becomes text: its text, then the URL in parentheses unless the text is the URL (R2.10);
  - every `image` and `imageReference` becomes text: its alt text, then the URL;
  - `html` nodes are dropped, and the sanitizer allows no `a`, `img` or raw HTML.

  `commentToHast(markdown)` is used by the pane; tests cover each kind of link and image.

<a id=""></a>
### 4.2 Server: The User's Name (`server/src/git.ts`)

- `gitUserName(root)`: `git -C <root> config user.name`, else `user.email`, else `os.userInfo().username` (R2.4). It is read when a change is written, at most once a minute (cached with its time), so a change of Git identity counts within a minute without a subprocess on every save.

<a id=""></a>
### 4.3 Server: Sidecars (`server/src/comments/`)

- **`sidecar.ts`**:
  - `parseSidecar(text)`: `{ threads }` or `{ problem, message }`, where `problem` is `unparsable`, `conflict-markers` (checked first, as `hasConflictMarkers` does for Markdown), `format`, `unknown-status` or `repeated-uid`.
  - `serializeSidecar(threads)`: the `yaml` package, keys in R3.2's order, `text` as a block scalar (`|-`) when it has a line break, so diffs and merges stay line-based (D7).
  - `commentVersion(comment)`: a short hash of its text and `updatedAt`, so the client can say which version it edited.
- **`CommentService`** (`comment-service.ts`), holding `FileService`, `SectionIndex` and the UID generator (CUID2, `UID_LENGTH`):
  - `threads(path)`: reads the sidecar (cached by modification time and size), and returns `CommentsResponse`. `available` is false for files that can't have threads (not sectioned, R2.11).
  - `change(path, change, user)`: serialized per path. It reads the sidecar again from disk, refuses if unusable, applies the change by UIDs, and writes with `writeAtomically`, deleting the file when no threads are left (R3.4). Rules:
    - `add-thread` needs the section's UID in the saved document (`sections.sectionsOf`); otherwise `not-found` (the client only offers it for saved UIDs, R2.11);
    - `edit` with a `baseVersion` that no longer matches the comment returns `conflict` with the thread as it is now (R3.3); an unchanged text is a no-op (R2.6);
    - `reply`, `edit` and `delete-comment` on a Resolved thread return `resolved` (R2.2);
    - `delete-comment` of a first comment with replies returns `has-replies`; of the only comment, deletes the thread (R2.9);
    - `set-status` sets `statusChangedBy`/`At`.

    It returns `{ ok: true, threads }` or `{ ok: false, reason, threads }`, so the pane always shows what is on disk.
  - `renamed(from, to)`, `deleted(path)`, `beforeCreate(path)`: see §4.4.
  - `problems(folder)` (R4): unusable sidecars (`comment-sidecar`, with `problem` and `message`), sidecars without a document (`orphaned-sidecar`), and threads whose `sectionUid` isn't in the saved document (`detached-thread`, with the thread's UID and its first line).

<a id=""></a>
### 4.4 Server: API, Files and Problems

- **Routes** (`shared/src/api/router.ts`):
  - `GET /api/comments?path=` → `CommentsResponse`;
  - `PATCH /api/comments?path=` with a `CommentChange` → the change result (§4.3);
  - both use `fileQuerySchema`, and `keepalive` is allowed on the `PATCH` (page close, §4.5).
- **Listing sidecars**: `gitMarkdownFiles` gains `:(glob)**/*.md.comments.yaml`, and the walk in `files.ts` collects them in a new `sidecars` list of `listFiles()`. The tree still shows Markdown files only (R3.5).
- **With the document** (R3.5, R3.6), in `server/src/app.ts`:
  - `rename` of a file: `comments.beforeCreate(newPath)` (deletes a leftover sidecar at the new name), `files.rename`, then `comments.renamed(path, newPath)`, which renames the sidecar if there is one. A folder rename carries its sidecars already.
  - `create` of a file: `comments.beforeCreate(path)` first.
  - `deleteEntry` of a file: `comments.deleted(path)` after; `deletePreview` lists the sidecar with it. A folder delete removes everything in it already; the preview's walk lists sidecars like other files.
- **Problems**: `sectionProblems(folder)` returns `sections.problems(folder)` followed by `comments.problems(folder)`. `SectionProblem` gains the three kinds.
- **Agent rule** (R3.7): `shared/src/sections/agent-guide.ts` gains "When moving, renaming or deleting a document, move, rename or delete its `.md.comments.yaml` with it, and otherwise leave it alone." `AGENTS.md`'s guide block is regenerated from it and `CLAUDE.md`'s "Section anchors" gets the line by hand.

<a id=""></a>
### 4.5 Saving the Document When Leaving the Window (R9)

- **Window `blur`** in `App.tsx`'s autosave effect: `docStore.save()` and `uiStore.flush()`, without `keepalive` (the page stays alive). A switch that also hides the tab writes once, since the second save finds nothing changed.
- **Pending edits**: `DocumentStore` gains `addFlusher(fn): () => void`; `save` calls each flusher before reading the text. `MilkdownEditor` registers one that serializes the editor's current document (`getMarkdown()`) and, if it differs from the last value it reported, calls `onChange` at once, so the debounced listener has nothing left to say. The flusher is removed when the editor unmounts.
- **Comments too**: the comment store (§4.7) registers its open editor's draft with the same autosave triggers: blur of the comment editor (R2.6), window `blur`, and `pagehide` (with `keepalive`).

<a id=""></a>
### 4.6 Client: UI State, Top Bar and Panes

- **UI state** (`shared/src/uistate/uistate.ts`): `sidePane` (`"chat" | "comments" | null`) replaces `chatOpen` in both schemas. `parseUiState` reads an old `chatOpen: true` as `"chat"` when `sidePane` is absent (R1.4); the server writes only `sidePane` from then on. Also `commentsPaneFraction` (its own limits, same as chat's) and `commentFilter` (default `"open"`), with setters like `setChatPaneFraction`.
- **`PaneLayout`**: `chatOpen`/`chatFraction` become `rightOpen`/`rightFraction`/`rightLabel`; `App` passes the open pane's fraction and setter.
- **Icons** (R1.1, R1.2): `ChatToggle`'s icon mirrored (`scale-x-[-1]`) with a small four-point star (lucide's `Sparkle`, scaled into the bubble) as one inline SVG; a new `CommentsToggle`, an inline SVG of a hollow round bubble with its tail at the lower left (drawn to match Font Awesome's regular comment; lucide has no such shape). The header's gap before `ThemeToggle` doubles. Both are `aria-pressed` toggle buttons setting `sidePane`.

<a id=""></a>
### 4.7 Client: Comment Store, Pane and Editor

- **`CommentStore`** (`client/src/app/comment-store.ts`), like `ChatStore`:
  - state: the open file's `threads`, `available`, `unusable`, the filter (from UI state), expanded threads, the thread or comment being edited, a pending-new-thread section, the highlighted section (`{ uid, from: "pane" | "pip" }`) and a flash counter;
  - loads `GET /api/comments` when a file opens, after each document save (UIDs may have just been given), and when the window regains focus;
  - `change(...)` sends a `CommentChange` and takes the returned threads; on `conflict` it drops the draft and shows the notice (R3.3).
  - derived per render: `counts(filter)` by section UID, and `groups(body)`: the sections of the current body (`analyzeBody`) with threads, in document order, each with ID, title and effective status (`sectionStatuses`); threads whose section isn't in the current body go to **Detached** (D8).
- **`CommentsPane`** (`client/src/components/comments/`): the filter (a segmented control, R7.5, with the hidden count), the groups (`GroupHeader`: ID, title, status chip, **+ New thread**), `ThreadCard` (collapsed: first comment, reply count, status; expanded: comments, reply editor or **Reopen**, R7.3), and the **Detached** group. Comments render through `commentToHast` and the hast-to-React renderer the chat uses. Times use `Intl.DateTimeFormat` in the browser's locale; "edited" has `updatedBy` and the time in its tooltip.
- **`CommentEditor`**: a small Milkdown editor (commonmark, GFM, history, listener) without the section anchor view. Links and images are turned to text by an `appendTransaction` plugin that removes `link` marks and replaces `image` nodes with their alt text and URL, so a paste or typed `[x](y)` never stays a link (D5). Escape: a keymap entry that restores the original text (or discards a new comment) and blurs without saving (R2.7). Blur saves (R2.6): empty new comments and unchanged text are dropped; a cleared existing comment gets its text back.
- **Deleting**: **Delete** on replies (and on a lone first comment), **Delete thread** behind a shadcn `AlertDialog` (R2.9).

<a id=""></a>
### 4.8 Client: Pips and Highlights in the Three Views

- **One model**: `ContentView` receives `commentMarkers: { counts: Map<uid, number>, highlight: string[] | null, flash: { uids: string[], n: number } | null, hidden?: … }` and callbacks `onPip(uid)` and `onPipHover(uid | null)`. `highlight` is the section's UID plus its descendants' (from `sectionExtents`/`descendantsOf` on the current body).
- **`CommentPip`** (`client/src/components/comments/CommentPip.tsx`): a small bubble with the count, a focusable button with the accessible name of R5.8; hover/focus shows a Radix tooltip with the first line of each shown thread (R5.3); click, Enter or Space calls `onPip` (R5.4).
- **Preview**: `Link` renders `CommentPip` after `SectionBadge` when the count is non-zero (it already reads from a ref, so counts don't remount badges). Highlighting (D4): `Preview` marks each top-level hast child and each sectioned list item with `data-section-uid`, its innermost section, from `sectionExtents` by source offset (the way `summarizeTree` maps children); a `<style>` element in the preview sets the tint for `[data-section-uid="…"]` of the highlighted UIDs. The flash is the same rule with an animation class, skipped under `prefers-reduced-motion`.
- **Summary roll-up** (R5.6, preview only, since the slider is there): for the shown stop, sections whose anchors fall inside a summarized range (heading excluded) are hidden; their counts move to the nearest visible ancestor (`sectionParents`), and the pip says "3 (2 hidden)".
- **WYSIWYG**: a ProseMirror plugin `commentDecorations`:
  - its state holds the counts and highlight, set by a transaction with plugin meta (not added to history, not reported as a change: the listener ignores `addToHistory: false`);
  - it adds a widget decoration (a `CommentPip` DOM element, with the same event stopping as the badge) after each anchor `html` node whose UID has a count, and node/inline decorations with the tint over the highlighted sections' nodes;
  - widgets are keyed by UID and count, so typing doesn't recreate them. Node views aren't touched (D3).
- **Text view**: a `commentGutter` extension created once per `ContentView` (stable identity, as `CodeEditor` requires): a `StateField` of counts and highlight, set by `StateEffect`s sent through the view `CodeEditor` hands back in a new `onView` prop. A `gutter` puts a `GutterMarker` (the pip) on each anchor line with a count; `Decoration.line` tints the highlighted extents. Positions map through changes, so markers follow edits until the next recount.
- **Hover from pips** (R6.2) sets the store's highlight with `from: "pip"`; the pane tints those threads.

<a id=""></a>
### 4.9 Following the Document (R7.7)

- Each view reports the topmost visible section's UID through `onTopSection(uid)`, throttled to animation frames:
  - preview: an `IntersectionObserver` over the anchors;
  - text: `view.lineBlockAtHeight(scrollTop)` → offset → the section whose extent holds it;
  - WYSIWYG: `posAtCoords` at the top of the scroller → the same.
- The pane scrolls the group of that section, or of the nearest section above it with threads, into view, unless the pointer is over the pane or focus is in it (so it never moves under the user).

<a id=""></a>
### 4.10 Moving To a Section, F8 and the Badge Menu

- **Scrolling to a UID**: `ScrollTarget` gains `{ sectionUid }`. The preview already scrolls to anchors; the text view scrolls to the anchor's line (`EditorView.scrollIntoView`), the WYSIWYG view to the anchor node's position. Each then flashes the section (R6.4).
- **F8 / Shift+F8** (R8): a `keydown` listener on `window` in `App` (capture phase, neither editor binds F8) moves through the shown threads in group order, wrapping at the ends; it opens the Comments pane if needed, expands and focuses the thread, and scrolls the document.
- **Badge menus** (R5.5): `SectionMenu` gains **Add comment…** (disabled with "Save the file first to give this section its ID" when the anchor has no UID or the file has unsaved anchor placeholders for it) and **Show comments**; both kinds of badge pass the callbacks.

<a id=""></a>
## 5. Phases

<a id=""></a>
### Phase 1: Saving When Leaving the Window

- §4.5's window `blur` and the WYSIWYG flusher, on their own (D9).
- Tests: `DocumentStore.save` calls flushers first; a component test types in `MilkdownEditor` and saves within 200 ms, and the save holds the text; `App` saves on `blur`.
- *Done when* `bun run typecheck` and `bun test` pass, and an end-to-end test (Alt+Tab can't be scripted; it dispatches `blur` on the window) sees the file saved.

<a id=""></a>
### Phase 2: Shared Foundations

- §4.1, the UI state changes of §4.6, the agent rule (§4.4).
- Unit tests: the sidecar schema and its extra checks; `sidecarPath`; `sectionExtents` and `descendantsOf` for the root, ATX and setext headings, list items and nested lists; comment Markdown with raw HTML, inline/reference links and images, autolinks and bare URLs; `parseUiState` with old `chatOpen`, and the new fields' fallbacks.
- *Done when* `bun test` passes.

<a id=""></a>
### Phase 3: The Server

- §4.2, §4.3, §4.4.
- Unit and API tests: `parseSidecar` for each problem; each change, including on a file changed on disk (kept), an edit to a comment changed on disk (`conflict`), Resolved threads, a first comment with replies, the last thread (sidecar deleted); `serializeSidecar` round trips and block scalars; the user's name from Git and from the login name; rename, create over a leftover, delete and the delete preview; the three problems; sidecars from the Git listing and from the walk.
- *Done when* `bun test` passes.

<a id=""></a>
### Phase 4: The Client: Pane, Store and Editor

- §4.6, §4.7.
- Component tests: the three-way toggle and UI state; the pane's groups in document order, filter and hidden count, collapse, **+ New thread** collapsing the others, Resolved threads read-only, **Detached**; the editor's save on blur, Escape, a cleared comment, links and images turned to text; delete rules and the confirmation; the conflict notice.
- *Done when* `bun run typecheck` and `bun test` pass.

<a id=""></a>
### Phase 5: The Client: Markers, Highlighting, Following and F8

- §4.8 to §4.10.
- Component tests: pips and counts under each filter in the preview, and their tooltip and accessible name; the summary roll-up; the WYSIWYG plugin's widgets and decorations (from plugin state, without changing the document or the undo history); the text view's gutter markers and line tints following an edit; badge menu items; F8 order and wrap-around.
- *Done when* `bun run typecheck` and `bun test` pass.

<a id=""></a>
### Phase 6: End-to-End Tests

- `e2e/comments.spec.ts`:
  - add a thread from the badge menu in the preview, reply, edit the reply (Edit, type, click away), resolve, reload, and check the pane and the sidecar on disk;
  - the same thread's pip in the text and WYSIWYG views; hovering a thread tints its section in each;
  - Escape abandons an edit; a cleared comment comes back;
  - rename the document and see the sidecar follow; delete it and see the sidecar gone;
  - delete the section, save, and see the thread in **Detached** and **Section problems…**;
  - F8 and Shift+F8 across groups;
  - an edit while the sidecar is changed on disk to another thread (kept) and to the same comment (refused, with the notice).
- `e2e/fixtures.ts` gains a helper that writes a sidecar, and the fixture sets `user.name` in the temporary repository.
- *Done when* the suite passes on Chrome and WebKit.

<a id=""></a>
### Phase 7: Documentation

- The specifications in requirements §5; `CLAUDE.md`: `server/src/comments/`, `shared/src/comments/`, `client/src/components/comments/` and `comment-store.ts`, the sidecar files, the agent rule, Step 012 in "Project state"; `AGENTS.md` regenerated.
- The docs sidebar gains Step 012 (requirements and plan), and an Implementation Status section is added here.
- *Done when* `bun run typecheck`, `bun test`, `bun run test:e2e` and `docs:build` pass.

<a id=""></a>
## 6. Decisions

_Proposed_; the work proceeds on them unless they are changed:

- **D1. Changes, not files, go to the server** (§4.3). Saving on every blur means many small writes, and a Git pull can land between them. Each change is applied by UIDs to a fresh read of the sidecar, so other threads changed on disk survive, and only an edit to a comment whose version changed is refused, as R3.3 asks.
- **D2. No file watching** (§4.7). The client reloads threads when a file opens, after saves, after each change and when the window regains focus, as the status lists do; the server caches by modification time and size. A change on disk while Specquer has focus shows at the next of these.
- **D3. Decorations, not node views, for pips and highlights in the editors** (§4.8). The WYSIWYG badge's node view is built once per node, and `CodeEditor` reads its extensions once. Plugin state set by meta transactions, and a `StateField` set by effects, update without rebuilding anything or touching the undo history.
- **D4. The preview highlights with a generated style rule** (§4.8). Marking elements with their section once per render and switching a `<style>` rule on hover avoids re-rendering the preview tree on every hover.
- **D5. Links and images are converted, not left out of the schema** (§4.7). Milkdown's commonmark parser needs the `link` and `image` schemas to read text that contains them; a transaction filter turns them into text whatever their source (typing, paste, or text loaded from a hand-edited sidecar).
- **D6. Comment Markdown is rendered by a shared pipeline** (§4.1), like chat answers, so what the pane shows can be tested without a DOM, and raw HTML never reaches React.
- **D7. Comment text as block scalars** (§4.3). Multi-line text in `|-` blocks keeps a sidecar's diffs and merges line by line.
- **D8. The pane groups by the text being edited; problems use the saved file** (§4.7). Pips already follow unsaved edits (R5.7), so the pane does too: a thread whose section was deleted shows in **Detached** at once. **Section problems…** lists it only after the save, like the other problems.
- **D9. R9 ships first, on its own** (Phase 1). It fixes a bug that exists today and touches none of the comments code.
- **D10. The filter applies with the pane closed** (§4.6). It is in UI state, and the pips follow it (R5.1); changing it needs the pane, which a pip click opens.

<a id=""></a>
## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Widget decorations inside ProseMirror's editable area | Cursor and selection quirks next to the pip in WYSIWYG | `side: 1`, `ignoreSelection`, the badge's event stopping; end-to-end tests on Chrome and WebKit |
| The WYSIWYG flusher serializes the document on every save | Slower saves on long files | Only when the listener has a pending change; the 60-second timer and blur are infrequent |
| Saving comments on blur of the window | A half-written comment is saved | R2.7's Escape, editing and deleting; accepted in the requirements |
| `blur` fires when focus moves to the address bar or devtools | Extra saves | Writes happen only when the text changed |
| Extents in three renderings | The tint covers the wrong elements in one view | One `sectionExtents` in `shared`; each view maps offsets to its own elements, with tests per view |
| Hand-edited or merged sidecars | Unusable files stop comment writes | Reported as problems (R4.1); the pane says why it shows no threads |
| `listFiles` grows with sidecars | Slower scans in large trees | Sidecars are found by the same walk or Git listing, not a second pass |
