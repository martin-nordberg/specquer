<a id=""></a>

<a id=""></a>
# Step 011 - Implementation Plan

_Plan for the [Section Status requirements](requirements.md). Drafted October 2026._

<a id=""></a>
## 1. Summary

Step 011 gives each section a status, kept in its anchor as `data-status`, inherited from its parent section within one prefix, checked against a per-prefix list in `.specquer/shared/<prefix>/prefix.config.yaml`, and changed from a menu on the section badge.

Most of the work extends what exists. Three parts are new:

| New | Where | Why it matters |
|---|---|---|
| Effective status, computed in `shared` | `shared/src/sections/status.ts` | The server needs it for problems and save corrections. The client needs it for the tooltip and the dialog, from the text being edited, not the saved file. One function serves both, so they can't disagree (§4.2) |
| A second kind of shared configuration under `.specquer/shared/<prefix>/` | `server/src/sections/prefix-config.ts` | It is hand-edited, read again when it changes, and can be unusable. That is the first configuration problem reported as a section problem (§4.3) |
| An edit to the open buffer that doesn't come from typing or a save | `SectionAttributesDialog`, the editors | Specquer has only changed the buffer with a save's anchor edits, which are kept out of the undo history. This change must be an ordinary, undoable edit, in three views (§4.7) |

There are five phases (§5):

1. shared foundations;
2. the server;
3. the client;
4. end-to-end tests;
5. documentation.

Decisions taken while planning are in §6, marked _Proposed_; the work proceeds on them unless they are changed.

<a id=""></a>
## 2. Precedence

The requirements' Precedence table applies. This plan adds:

| Topic | Before | Step 011 (wins) |
|---|---|---|
| A section's parent | Worked out inside `sectionPrefixes` (server) | `sectionParents` in `shared/src/markdown/sections.ts`, used by prefixes and statuses (§4.1) |
| `anchorEdits` | Edits `id` and `data-uid` | Also replaces a `data-status` value, for corrections on save (§4.1, §4.4) |
| Badge menus | None; a click copies the ID | One `SectionMenu`, opened at the badge by right-click or the keyboard, in the preview and the WYSIWYG view (§4.6) |
| The WYSIWYG badge | A non-focusable image with the ID as its `title` | Focusable, with the status in its `title`, and the menu (§4.8) |
| `CodeEditor` outside changes | Always kept out of the undo history | A change marked undoable goes into the history (§4.7) |
| **Add section anchors** | Adds and corrects IDs and UIDs | Also corrects the capitalization and spaces of statuses, as a save does (§4.4, D5) |

<a id=""></a>
## 3. Starting Point

- **Anchors** (`shared/src/markdown/sections.ts`):
  - `anchorAt` reads an anchor's `id` and `data-uid` from the open tag's attributes, with their ranges. Other attributes are ignored.
  - `FoundSection` has `kind`, `id`, `uid`, `requestedPrefix`, `anchor` and `depth`. It has no parent and no line.
  - `anchorEdits(body, sections, { ids, uids })` replaces only the `id` and `data-uid` attribute ranges, so a `data-status` already survives renumbering, UID repair and prefix changes.
  - `StrayAnchor.line` is counted in the body, and `analyzeBody` computes it.
- **Prefixes** (`server/src/sections/prefixes.ts`): `sectionPrefixes` works out each section's prefix top-down. A requested prefix comes first, then the ID's (if known), then the parent's, and for the root the folder's. The parent rule (nearest heading above at a higher level, the heading holding a list, else the root) lives only here.
- **The index** (`server/src/sections/section-index.ts`):
  - `anchor()` analyzes the body, reconciles, allocates IDs and returns body edits and notices. It leaves files with conflict markers alone. `save`, `anchorFolder`, `renumber` and `renumberDocument` all go through it.
  - `problems(folder)` lists nested Specquer folders, copied documents, duplicates and collisions, conflict markers and strays.
  - `IndexedDocument` keeps the `FoundSection`s of each sectioned file.
- **Data files** (`server/src/sections/data.ts`): `DataFiles` lists the prefix folders under `.specquer/shared/` and stats each `sections.yaml`, reading them again when a signature of modification times changes. There are no other files in those folders.
- **API** (`shared/src/api/`): `GET /api/sections?path=` returns `SectionInfo[]`, and `GET /api/sections/problems?folder=` returns `SectionProblem[]`, a union of five kinds.
- **Preview badge** (`client/src/components/SectionBadge.tsx`):
  - A button with a Radix tooltip (ID, path, UID, the duplicate problem and **Renumber this one**).
  - `onClick` copies the ID and shows "Copied" in the tooltip.
  - `Preview.tsx` renders it for each marked anchor, with `SectionInfo` from `loadSections` for problems.
- **WYSIWYG badge** (`client/src/components/MilkdownEditor.tsx`): `sectionAnchorView` turns the open tag's `html` node into a `span` with `role="img"`, `title` = the section ID and no handlers. Paste turns a taken anchor into `<a id="">`, dropping its other attributes.
- **Buffer** (`client/src/app/document-store.ts`):
  - `setBody` is the one way to change the body.
  - A save's edits are applied with `rebaseEdits` and bump `externalEdits`, which remounts the WYSIWYG view.
  - `CodeEditor` applies every outside `value` change with `Transaction.addToHistory.of(false)`.
- **Menus and dialogs** (`client/src/components/ui/`): shadcn `context-menu`, `dropdown-menu`, `dialog` and `tooltip` are already copied in. `FileTree.tsx` uses `ContextMenu`. `lucide-react` provides `Copy` and `ListChecks`.
- **Problems dialog** (`client/src/components/ProblemsDialog.tsx`): `describe(problem)` switches on `kind`.
- **Agent rules**: `shared/src/sections/agent-guide.ts` holds the rules' text. `server/src/sections/agent-guide.ts` writes them to `AGENTS.md`, and `CLAUDE.md` repeats them by hand.

<a id=""></a>
## 4. Proposed Design

<a id=""></a>
### 4.1 Anchors (`shared/src/markdown/sections.ts`)

- **Reading the status:**
  - `FoundAnchor` gains `status?: string` (the raw value, untrimmed) and `statusAttribute?: Range`, read in `anchorAt` like `data-uid` (the first occurrence wins).
  - It also gains `line`, counted in the body as for strays, for the problem's line (R6.1).
- **Parents:** `sectionParents(sections): Array<number | null>` gives each section's parent index (`null` for the root), by the rule now inside `sectionPrefixes`. `sectionPrefixes` moves on top of it, unchanged in behavior. Its tests keep their outcomes.
- **Corrections on save:** `AnchorPlan` gains `statuses?: Map<number, string>`. `anchorEdits` replaces the `statusAttribute` range with `data-status="<value>"` for each entry. The edit doesn't overlap the `id` and `data-uid` edits, so sorting stays as it is.
- **Setting a status:** `statusEdit(body, section, status: string | null): BodyEdit | undefined` is the single edit the dialog makes (R5.4), on the anchor found in the current body:
  - `null` removes the attribute with the space before it;
  - a value replaces the attribute, or inserts ` data-status="…"` directly after `data-uid` (or after `id` when there is no `data-uid`), as R1.7 requires;
  - the value is the allowed value as written; `"` can't occur in it (§4.3).
- **The open tag alone:** `withStatus(openTag, status)` does the same to a tag string, for the WYSIWYG view's `html` node (§4.8). `statusEdit` and `withStatus` share the attribute logic.

<a id=""></a>
### 4.2 Effective Status (`shared/src/sections/status.ts`)

- `DEFAULT_STATUS_VALUES`: the six values of R2.3, in order.
- `matchStatus(raw, allowed)`: the allowed value equal to `raw` after trimming, ignoring case, or `undefined`. A blank `raw` never matches (R1.4, R1.5).
- `sectionStatuses(sections, { allowed, folderPrefix })` returns one entry per section, in one pass from the root down (§4.1's parents):
  - `prefix`: the requested prefix, else the ID's, else the parent's, else `folderPrefix`;
  - `own`: the raw `data-status`, or `null`;
  - `valid`: `own` is `null` or matches; `canonical`: the match;
  - `inherited`: the parent's `passOn` when the parent has the same prefix, else `allowed(prefix)[0]` (R3.1, R3.2);
  - `passOn`: `canonical` when there is a valid own status, else `inherited`. A parent with an invalid status passes on what it inherited (R3.4);
  - `effective`: `passOn`, or `null` when `own` is invalid.
- `allowed(prefix)` returns the prefix's usable list, or `DEFAULT_STATUS_VALUES`.
- It has no Bun or DOM APIs and runs on both sides. The server uses it with the index's sections; the client uses it with `analyzeBody` of the body being edited.

<a id=""></a>
### 4.3 Prefix Configuration (`server/src/sections/prefix-config.ts`, `shared/src/settings/`)

- **Shared:** `PREFIX_CONFIG_FILE = "prefix.config.yaml"` and `prefixConfigSchema` (`statusValues: string[]`) in `shared/src/settings/`, ready for a settings dialog later (requirements §4).
- **`parsePrefixConfig(text)`** reads the file with the `yaml` document API. It returns `{ statusValues }` or `{ problem }`, where `problem` is one of:
  - `unparsable` (with the parser's message);
  - `missing-list` (no `statusValues`, or not a list);
  - `empty-list`;
  - `bad-value` (not text, blank, or holding `"`, which can't be written in an attribute);
  - `repeated-value` (equal after trimming, ignoring case).

  Values are trimmed (R2.2). Other keys are ignored.
- **`PrefixConfigs`**, the reader:
  - It lists the prefix folders under `.specquer/shared/` as `DataFiles` does, and keeps each `prefix.config.yaml`'s modification time and size. `load()` reads only the files that changed, so a hand edit counts from the next load (R2.5).
  - It gives `allowed(prefix)` (§4.2) and `problems()`, the unusable files by prefix.
- **The index** holds a `PrefixConfigs` beside `FolderConfigs`, and `load()` loads both.

<a id=""></a>
### 4.4 The Index (`server/src/sections/section-index.ts`)

- **Corrections on save** (R1.5): in `anchor()`, after the prefixes are worked out, `sectionStatuses` runs on the sections with each section's final prefix. A section whose own status is valid but differs from its `canonical` value goes into `plan.statuses`.
  - The edits come back with the save's other edits, so the client applies them as anchor edits: at once, outside the undo history, not counted as unsaved.
  - No notice is shown (R1.5 calls the correction silent).
  - A dry run counts a correction as a change.
  - Files with conflict markers are left alone, as now.
- **Problems** (R6): `problems(folder)` adds two kinds:
  - `invalid-status`: for each indexed document in the folder, each section with an ID whose own status is invalid. The problem carries `path`, `id`, `line`, `value` and `prefix`. Placeholders are left out; they get an ID on the next save, and are reported from then on.
  - `prefix-config`: each unusable file, with `prefix`, `path` (`.specquer/shared/REQ/prefix.config.yaml`), `problem` and `message`. It is listed for a folder when any indexed document in the folder has a section with that prefix (R6.2).
- **Statuses for the client:** `statuses(path)` returns:
  - `sectioned`;
  - `folderPrefix`;
  - `statusValues`: the usable list of every prefix that has a usable file. Other prefixes use the defaults, which the client has in `shared`.

<a id=""></a>
### 4.5 API (`shared/src/api/`, `server/src/app.ts`)

- `SectionProblem` gains the two kinds of §4.4.
- `GET /api/sections/statuses?path=` (schema `fileQuerySchema`) returns `{ sectioned, folderPrefix, statusValues: Record<string, string[]> }`.
- No other route changes. `SectionInfo` stays as it is: the client works statuses out from the text it holds, which may not be saved yet.

<a id=""></a>
### 4.6 The Preview Badge (`SectionBadge.tsx`, new `SectionMenu.tsx`)

- **Tooltip** (R4.1): the first line becomes `{id} - {status}`:
  - an inherited status gets `(inherited)`;
  - an invalid status of its own shows as written with `(not allowed)`, and the button gets `section-badge-problem` (the warning ring).

  The badge takes a `status` prop (`{ text, inherited, invalid } | undefined`). `undefined` (a file that isn't sectioned) shows the ID alone.
- **No click action** (R4.2): `onClick` and the copy state in the tooltip go. The `aria-label` becomes "Section SPEC-00012, Peer Review" (with "inherited" or "not allowed" as needed), and the ID-used-twice note stays.
- **`SectionMenu`**: one controlled menu (shadcn `DropdownMenu`, anchored at a point), shared by both kinds of badge (D2). It has:
  - **Copy this section ID** (`Copy`), which copies and then shows "Copied SPEC-00012" in the badge's tooltip, as the click did;
  - **Section attributes…** (`ListChecks`), disabled with a tooltip ("This file has merge conflict markers; resolve them first") when `hasConflictMarkers(body)` (R4.3), and left out when the file isn't sectioned.
- **Opening the menu** (R4.3, R4.4): `contextmenu` on the badge (the browser menu is suppressed), and on the focused badge `keydown` of `ContextMenu` or `Shift+F10`, handled directly rather than relying on the browser to fire `contextmenu` (D3).
- **Preview** computes the statuses once per rendered text, beside `buildOutline`: `sectionStatuses(analyzeBody(markdown).sections, …)`, keyed by `id/uid` for the `Link` component. The status lists come from §4.9.

<a id=""></a>
### 4.7 The Dialog and the Edit (`SectionAttributesDialog.tsx`, `document-store.ts`, `CodeEditor.tsx`)

- **Dialog** (R5): a shadcn `Dialog` titled **Section attributes**, with the ID and title, and a native `<select>` labeled **Status**. The choices are:
  - `Inherited - {inherited}`;
  - the prefix's allowed values;
  - for an invalid own status, a disabled `{value} (not allowed)` choice, selected at first (R5.3).

  **OK** and **Cancel** close it. OK with the first choice unchanged, or the invalid choice still selected, edits nothing (R5.3, R5.5).
- **It opens on the current text:** the dialog finds the section in `analyzeBody(body)` by ID and UID when it opens and again on OK. If the anchor is gone by then, it says so and edits nothing.
- **The edit:** `DocumentStore.editBody(edit)` applies `statusEdit`'s edit to the body as an ordinary change (unsaved, picked up by autosave), and bumps `undoableEdits`.
- **Undo** (D4):
  - **Text editor (split view):** `CodeEditor` takes an `undoableEdits` counter. When `value` changes together with a bump of it, the change is dispatched with `addToHistory` true and `userEvent: "input.status"`, so Ctrl+Z in the text pane undoes it.
  - **WYSIWYG view:** the change is a ProseMirror transaction (§4.8), so Milkdown's history has it.
  - **Preview view:** there are no undo keys. Choosing again in the dialog reverts.

<a id=""></a>
### 4.8 The WYSIWYG Badge (`MilkdownEditor.tsx`)

- `sectionAnchorView`'s span gets `tabindex="0"`, `role="button"` and an `aria-label` like the preview badge's. The class `section-badge-problem` marks an invalid status.
- **Status in `title`:** the `title` is set on `mouseenter` and `focus`, from the latest Markdown. The editor keeps it in a ref, updated in `markdownUpdated`, together with the status lists passed as a prop. A node view isn't rebuilt when a parent's anchor changes, so the status has to be worked out when it is shown.
- **The menu:** `contextmenu`, `ContextMenu` and `Shift+F10` on the span call back into `MilkdownEditor` with the section ID, the node's position and the point. It renders the same `SectionMenu` and `SectionAttributesDialog`.
- **The edit:** on OK, `tr.setNodeMarkup(pos, undefined, { ...attrs, value: withStatus(value, status) })`. The listener then reports the new Markdown through `onChange`.
- **Paste:** unchanged. A copy's anchor becomes a bare `<a id="">`, dropping its status, as requirements R1.8 accepts.

<a id=""></a>
### 4.9 Status Lists in the Client (`App.tsx`)

- `App` loads `GET /api/sections/statuses` for the open file:
  - when a file opens;
  - after each save;
  - when the window regains focus (a hand edit to `prefix.config.yaml` usually happens in another window);
  - when the menu opens.

  It passes `{ sectioned, folderPrefix, allowed }` to `ContentView`, which hands it to `Preview` and `MilkdownEditor`.
- Until it loads, badges show the ID alone and the menu has only **Copy this section ID**.

<a id=""></a>
### 4.10 Problems Dialog and Agent Rules

- **`ProblemsDialog.describe`:**
  - `invalid-status`: "SPEC-00012's status "Revieww" isn't allowed for SPEC (docs/a.md, line 14)", opening the file at the section;
  - `prefix-config`: ".specquer/shared/REQ/prefix.config.yaml: {message}; REQ uses the default statuses", with no link, since Specquer opens only Markdown files.
- **Agent rules** (R1.9): `shared/src/sections/agent-guide.ts` gains:

  > Change a section's `data-status` only when asked to, and only to a value allowed for its prefix (`.specquer/shared/<prefix>/prefix.config.yaml`, or Draft, Approved, In Development, Peer Review, Testing, Complete).

  `AGENTS.md` here is rewritten with **Add section anchors**. `CLAUDE.md`'s "Section anchors" gets the same line by hand.

<a id=""></a>
## 5. Phases

<a id=""></a>
### Phase 1: Shared Foundations

- §4.1, §4.2, the shared part of §4.3, and the agent rule (§4.10).
- Unit tests:
  - `anchorAt` reads `data-status` in every anchor position (root, ATX and setext headings, list items, the anchor paragraph before a heading), with single, double and no quotes;
  - `anchorEdits` keeps `data-status` when it adds or corrects an `id` or `data-uid`, on `XYZ-?`, and when renumbering;
  - `plan.statuses` replaces only the value;
  - `statusEdit` and `withStatus` add (after `data-uid`, or after `id`), change and remove the attribute, and the result is recognized again with the same ID and UID;
  - `sectionParents` gives the parents `sectionPrefixes` used, and the prefix tests keep their outcomes;
  - `matchStatus`: case, surrounding spaces, blank;
  - `sectionStatuses`: own, inherited, the prefix boundary, the root, a parent with an invalid status, a list item under a heading, explicit values equal to the inherited one;
  - the agent guide holds the new rule.
- *Done when* `bun test` passes.

<a id=""></a>
### Phase 2: The Server

- §4.3, §4.4 and §4.5.
- Unit and API tests:
  - `parsePrefixConfig` for a good file and for each problem;
  - `PrefixConfigs` reads a changed file again and only then;
  - a save corrects `peer review` and `" Draft "` with no notice, and the edits apply to the body sent;
  - a prefix change that leaves a status invalid keeps the value and reports it;
  - a file with conflict markers is left alone;
  - **Add section anchors** lists a file whose only change is a correction;
  - `invalid-status` for blank and unknown values, with the line;
  - `prefix-config`, listed only for folders holding the prefix, and the prefix then uses the defaults;
  - `GET /api/sections/statuses` for sectioned and non-sectioned files.
- *Done when* `bun test` passes.

<a id=""></a>
### Phase 3: The Client

- §4.6 to §4.10.
- Component tests:
  - the tooltip's line (own, inherited, not allowed) and the warning ring;
  - no copy on click;
  - the menu by right-click, `ContextMenu` and `Shift+F10`;
  - **Copy this section ID**;
  - **Section attributes…** disabled with conflict markers, and absent in a non-sectioned file;
  - the dialog's choices and order;
  - the disabled invalid choice;
  - OK with **Inherited** removes the attribute, and with a value adds it after `data-uid`;
  - OK without a change edits nothing;
  - `CodeEditor` undoes an undoable outside change, and still keeps anchor edits out of the history;
  - `ProblemsDialog` describes the two new kinds.
- *Done when* `bun run typecheck` and `bun test` pass.

<a id=""></a>
### Phase 4: End-to-End Tests

- `e2e/section-status.spec.ts`:
  - in Preview, right-click a heading's badge, choose **Section attributes…**, pick **Approved**, see the file marked unsaved and the subsections' tooltips say "Approved (inherited)", save, reload and see it again;
  - in split view, do the same and undo it with Ctrl+Z in the text pane;
  - in the WYSIWYG view, set a status from the badge, save, and check the file on disk;
  - **Copy this section ID** from the keyboard (`Shift+F10`);
  - write `data-status="approved"` in the text editor, save, and see `Approved`;
  - write `data-status="Revieww"`, and see it in **Section problems…** and as a ring on the badge;
  - write a `prefix.config.yaml` with a repeated value, and see the problem and the default list in the dialog.
- `e2e/fixtures.ts` gains a helper that writes a prefix's `prefix.config.yaml`.
- *Done when* the suite passes on Chrome and WebKit.

<a id=""></a>
### Phase 5: Documentation

- The specifications in requirements §5. `CLAUDE.md`: `prefix-config.ts` and `status.ts` in the package descriptions, `prefix.config.yaml`, the agent rule, and Step 011 in "Project state".
- `AGENTS.md` rewritten with the new rule (§4.10).
- The docs sidebar gains Step 011 (requirements and plan), and an Implementation Status section is added here.
- *Done when* `bun run typecheck`, `bun test`, `bun run test:e2e` and `docs:build` pass.

<a id=""></a>
## 6. Decisions

_Proposed_; the work proceeds on them unless they are changed:

- **D1. Statuses are worked out in the client, from the text being edited** (§4.2, §4.5). The tooltip and the dialog then follow unsaved edits, including the dialog's own, at once. The server would have to be asked on every change otherwise. The server uses the same function, so problems and corrections agree with what the client shows.
- **D2. One menu component, opened at a point,** for both kinds of badge (§4.6). Radix's `ContextMenu` wants its trigger as a React element, but the WYSIWYG badge is a DOM node built by a ProseMirror node view. A controlled `DropdownMenu` anchored at a point works for both, and avoids nesting a context-menu trigger inside the tooltip trigger.
- **D3. The keyboard opens the menu directly** (§4.6). Browsers differ on whether `Shift+F10` fires `contextmenu`, WebKit on macOS has no context-menu key, and Playwright doesn't synthesize the event from key presses. Handling both keys on the badge makes R4.4 testable and the same everywhere.
- **D4. Undoable where the view has undo** (§4.7). Requirements R5.4 asks for an ordinary, undoable edit. The text editor and the WYSIWYG view put it in their histories. The preview has no undo, and the dialog is how a change is reversed there.
- **D5. Every path through `anchor()` corrects statuses**: saves, **Renumber**, **Renumber this copy** and **Add section anchors**. They all write files "as a save would", and one rule is easier to explain than four.
- **D6. Unusable configuration files are found by the reader, not by scans of Markdown files** (§4.3). Their problems need no document to be open, and the defaults apply as soon as the file is read.
- **D7. No status on `SectionInfo` for now** (§4.5). Nothing outside the open file shows a status yet (requirements §4). Adding it later, for the outline or link completion, is a field and a call to `sectionStatuses`.

<a id=""></a>
## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Parsing the body again in the client for statuses | Slower previews on long files | It runs once per rendered text, like `buildOutline` (which already parses it); measure on the largest spec, and share one `analyzeBody` between the two if needed |
| A focusable span inside ProseMirror's editable area | Focus and selection quirks in the WYSIWYG view | `contentEditable=false` stays; key handlers stop propagation; the end-to-end test covers it on Chrome and WebKit |
| The tooltip and the menu on one button | Hover, focus and menu fight over the badge | The menu is controlled and opened at a point (D2); component tests cover hover, focus and the menu together |
| An undoable outside change in `CodeEditor` | Anchor edits from saves could end up undoable by mistake | The counter marks only the dialog's change; a test checks a save's edits stay out of the history |
| Duplicate IDs within one file | The preview's `id/uid` key could find the wrong section's status | Such files already have a problem and a ring; the dialog finds the section again by ID and UID when it opens and on OK |
| Hand-edited `prefix.config.yaml` | A typo marks every status of a prefix invalid | The defaults apply and the file is reported (D6), so a typo can't remove values |
