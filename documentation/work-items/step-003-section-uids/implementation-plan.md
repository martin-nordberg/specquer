# Step 003 - Implementation Plan

_Plan for [Section Anchor Conflicts](section-anchor-conflicts.md), the analysis whose recommendations (§6) and decisions (§7) serve as this step's requirements. Drafted October 2026._

## 1. Summary

Step 003 makes section identity travel with the text and stops Specquer from settling conflicts on stale or guessed information:

- Every section anchor carries its section's CUID2 as `data-uid`. The root anchor's UID is also the document ID, which replaces `data-document-id`.
- Reconciliation classifies each anchor by its ID and its UID together. Edited IDs are put back, retired IDs reused without their UID are renumbered, and copies within a document are renumbered automatically. Duplicates across documents and collisions between branches are reported and renumbered only when the user confirms.
- Two bugs are fixed: the data files are read again when they change on disk, and the index of every sectioned file is brought up to date before IDs are issued or duplicates settled.
- Files holding merge conflict markers are saved as sent, without anchoring.
- Specquer reports problems (duplicates, collisions, stray anchors, and what a save changed) instead of only fixing them.
- The text editor turns pasted copies of existing anchors into placeholders and shows `data-uid` in a muted color.
- A short guide tells coding agents how to treat anchors.

Link checking (recommendation 9 of the analysis) is left for a later step.

There are seven phases (§5). Decisions taken while planning are in §6, marked _Proposed_; the work proceeds on them unless they are changed.

## 2. Precedence

Step 003 takes precedence over Step 002 and the specifications where they conflict:

| Topic | Step 002 | Step 003 (wins) |
|---|---|---|
| Anchors | `<a id="X"></a>`; the root anchor also has `data-document-id` | Every anchor has `data-uid`; the root anchor's UID is the document ID; `data-document-id` is no longer read |
| Recognizing the root anchor | `data-document-id`, or not followed by a heading on the next line | Not followed by a heading on the next line, or holding a UID that `documents.yaml` records |
| CUID2 length | 24 | 12 for new UIDs; longer ones stay valid |
| `sections.yaml` | Live entries, without the root sections | Live entries for every section, root included (keyed by the document ID), plus `retired` |
| A known ID with a changed number | Accepted as a new ID; the old entry is dropped | The recorded ID is put back |
| A retired ID typed again | Accepted | Renumbered, unless it comes back with its old UID |
| Duplicates across documents | Renumbered on save | Reported; renumbered only when the user confirms |
| Data files | Read once per session | Read again when their modification time changes |
| Save | Uses the index as of the last scan | Brings the index up to date first; a file with conflict markers is written as sent |

No data migration: Specquer hasn't been used outside this repository, and this repository has no data files and no `data-document-id` anchors yet.

## 3. Starting Point

- **Recognition** (`shared/src/markdown/sections.ts`): `anchorAt` reads `id` and `data-document-id` from an anchor's open tag. `findSections` treats the first block's anchor as the root anchor if it has a `data-document-id` or no heading follows on the next line. `anchorEdits` takes an `AnchorPlan` with new IDs by section index and the document ID. `rootAnchorText(id, documentId)` writes a new file's anchor.
- **UID format:** checked twice, by `isCuidLike` in `server/src/sections/data.ts` and `validDocumentId` in `section-index.ts` (`^[a-z][a-z0-9]{1,63}$`). New CUID2s come from `createId` in `@paralleldrive/cuid2`, 24 characters long.
- **Data files** (`server/src/sections/data.ts`): `documents.yaml` maps a document ID to a path. `<prefix>/sections.yaml` holds `lastSequence` and live entries `uid: { id, documentId }`, without the root sections. `DataFiles.read` is called once, from `SectionIndex.load`.
- **Reconciliation** (`reconcile.ts`): keyed by section ID. The output is the reconciled data and, per document, its document ID and the section indexes to renumber.
- **Section index** (`section-index.ts`): `scan` runs at startup and on tree loads, which follow only Specquer's own create, rename and delete. `save` indexes only the file being saved. Section UIDs for the badge tooltip come from `sections.yaml`.
- **Client:** `CodeEditor` takes extensions once, when created (`ContentView.tsx` builds them in a `useMemo`). `SectionBadge` shows the ID, path and UID. `AnchorDialog` is the **Add section anchors** dialog. There is no toast or notice component yet.

## 4. Proposed Design

### 4.1 Anchors

```html
<a id="SPEC-00001" data-uid="tz4a98xxat96"></a>

## <a id="SPEC-00012" data-uid="k1v2u0xwq8y7"></a> Password rules

* <a id="REQ-00752" data-uid="p0o9i8u7y6t5"></a> Some requirement
```

- `data-uid` is written directly after `id`. Other attributes are kept, as now.
- **UID format** moves to `shared/src/sections/uids.ts`: `isUid` (`^[a-z][a-z0-9]{1,63}$`, so existing 24-character values stay valid) and `UID_LENGTH = 12`. The server creates UIDs with `init({ length: UID_LENGTH })`. `data.ts` and `section-index.ts` use `isUid` instead of their own checks.
- An invalid `data-uid` counts as missing. A placeholder (`<a id=""></a>`) may carry no UID or any UID; as now, it asks for an ID.

### 4.2 Recognition (`shared`)

- `FoundAnchor` gets `uid?: string` and `uidAttribute?: Range`, which replace `documentId` and `documentIdAttribute`. `FoundSection` gets `uid: string | null`.
- **The root anchor:** the first block's sole anchor is the root anchor unless the heading on the very next line follows it, or when `options.isDocumentUid(uid)` is true (D1). When a recorded document UID wins this way, the heading has no anchor. Its new anchor is inserted between the two, with a blank line above, which restores the usual layout.
- **`analyzeBody(body, options)`** returns `{ sections, strays }`. `findSections` stays as `analyzeBody(body).sections` for its current callers. `strays` are anchors whose `id` is in the section ID format but which aren't in a section position: not before or in a top-level heading, not at the start of an item of a top-level list, or in nested lists, block quotes or ordinary paragraphs. Anchors in code don't count. They come from walking the same tree, so the body is parsed once.
- **`hasConflictMarkers(body)`** is true when the body has a `<<<<<<< ` line and a `>>>>>>> ` line, each at the start of a line. Requiring both keeps a setext underline (`=======`) from counting.
- **`AnchorPlan`** becomes `{ ids: Map<number, string>; uids: Map<number, string> }`, by section index. `ids` gives new or restored IDs, and `uids` gives new or corrected UIDs (the root's UID is the document ID). `anchorEdits` inserts missing anchors with both attributes, replaces `id` and `data-uid` values, and adds a missing `data-uid` after `id`. `rootAnchorText(id, uid)` writes `<a id="…" data-uid="…"></a>` and a blank line.
- **Preview:** the sanitizer already allows `data-*` on `a`. Tests change from `data-document-id` to `data-uid`.

### 4.3 Data Files (`server/src/sections/data.ts`)

```yaml
# .specquer/shared/documents.yaml
documents:
  tz4a98xxat96: { path: documentation/specifications/overview.md }
```

```yaml
# .specquer/shared/SPEC/sections.yaml
lastSequence: 257
sections:
  tz4a98xxat96: { id: SPEC-00001, documentId: tz4a98xxat96 }
  k1v2u0xwq8y7: { id: SPEC-00012, documentId: tz4a98xxat96 }
retired:
  m3n4b5v6c7x8: { id: SPEC-00007 }
```

- Root sections get entries keyed by the document ID (D2).
- **`retired`:** a section whose UID no scanned document holds moves from `sections` to `retired` when the data files are next written. A retired UID that turns up again (a restore) moves back. Appended, one entry per line, read with the same tolerance for conflict markers. When both sides of a merge leave the same UID in `sections` and in `retired`, live wins.
- **Reading again:** `DataFiles` records each file's modification time and size when it reads or writes it. `changed()` checks them, and the folder listing for new prefixes. `SectionIndex.load` reads the data files again when anything changed. The index's in-memory data is replaced, but numbers already issued in this session are kept: `lastSequence` takes the higher of the two.

### 4.4 Reconciliation (`server/src/sections/reconcile.ts`)

Input: per document, its path, whether it is **frozen** (it has conflict markers), and its sections as `{ id: string | null, uid: string | null }`. The root section's `uid` is the document ID. Output: the reconciled data, per-document fixes, and problems.

Each document's fix: its document UID, plus `ids` (by section index: new or restored IDs), `uids` (by section index: new UIDs) and `notices` (what the fix does, for the save response).

Documents follow the Step 002 rules, keyed by the root anchor's UID: a missing one gets the UID recorded for the path or a new one, a copy keeps it only at the recorded path, and moves and removals are as before.

Sections, in this order:

| Found | Meaning | Fix | Reported |
|---|---|---|---|
| No UID, or an invalid one | Written before Step 003, by hand, or with the UID removed | The UID recorded for this ID in this document, or else a new one | — |
| A known UID with another ID | An edited ID | The recorded ID is put back, unless another section now holds it | Notice |
| The same ID and UID twice in one document | A copy | The first occurrence keeps both; the copy gets a new ID and UID | Notice |
| The same ID and UID in several documents | A copy across documents | None until the user confirms; the recorded occurrence keeps the ID meanwhile | Problem: duplicate |
| The same ID with different UIDs | A collision | None until the user confirms; the recorded occurrence keeps the ID meanwhile | Problem: collision |
| The same UID with different IDs | A copied UID | The occurrence with the recorded ID keeps the UID; the others get new UIDs | Notice |
| A retired ID with its retired UID | A restore | The entry moves back from `retired` | — |
| A retired ID with no UID or another UID | Reuse | A new ID | Notice |
| An ID with an unknown prefix | As in Step 002 | A new ID with the file's prefix | Notice |
| A new ID and a new UID | Added elsewhere | An entry, appended | — |

- "Recorded" means the entry in `sections.yaml`, or `retired`, as last read or written.
- A frozen document's sections count as present: they aren't retired, and they raise `lastSequence`. They get no fixes and don't take part in settling duplicates.
- Problems are also produced for stray anchors (from `analyzeBody`) and for frozen documents.
- Renumbering a duplicate or collision that the user confirms is a fix requested from outside, `renumber: { path, index }`, applied like any other.

### 4.5 Section Index (`server/src/sections/section-index.ts`)

- **Up-to-date index:** `save`, `create`, `anchorFolder`, `problems` and `renumber` start with the scan's stat pass (`scanFiles`): it lists the Markdown files, stats them, and reads only the changed ones. The cost is measured in Phase 0 (D3).
- **Data files** are read again through `DataFiles.changed()` in `load` (§4.3).
- **Conflict markers:** a sectioned file whose body has conflict markers is saved as sent, without anchoring. The response carries a notice. The scan indexes it as frozen.
- **UIDs:** `newUid` is `init({ length: 12 })`. `describe` takes UIDs from the anchors. A section waiting for the user's decision shows its `problem`.
- **`problems(folder)`** returns the problems for the sectioned files in a folder: duplicates and collisions (with every occurrence's path and title), stray anchors, and frozen files.
- **`renumber(path, uid, baseVersion)`** gives one occurrence of a duplicate or collision a new ID (and a new UID for a copy). The file is rewritten as a save would, with the version check. The edits are returned.

### 4.6 API (`shared/src/api`)

| Change | Details |
|---|---|
| `SaveResult` | Gets `notices?: SectionNotice[]`: `{ kind: "renumbered" \| "restored" \| "uid-replaced" \| "not-anchored", id, newId?, title }` |
| `SectionInfo` | `uid` comes from the anchor. Gets `problem?: { kind: "duplicate" \| "collision", others: Array<{ path, title }> }` |
| `GET /api/sections/problems?folder=` | `{ problems: SectionProblem[] }` |
| `POST /api/sections/renumber` | Body `{ path, uid, baseVersion }`. Returns a `SaveResult` with the edits |

### 4.7 Client

- **Paste handling** (`client/src/components/section-paste.ts`, a CodeMirror extension created once in `ContentView`):
  - A transaction filter for `input.paste` finds the anchors in the pasted text with the shared anchor parser.
  - An anchor whose ID also occurs in the document outside the pasted range becomes a placeholder: `<a id=""></a>`, without its `data-uid`.
  - For the other IDs it calls `GET /api/sections/search` with each ID, after the paste. If another document holds an ID, a follow-up transaction outside the undo history turns that anchor into a placeholder.
  - A cut followed by a paste keeps its IDs, because the cut has already removed them and opening another file saves the current one first.
- **WYSIWYG paste:** Milkdown pastes through ProseMirror, so it needs a `transformPasted` hook in the raw-HTML node handling. Phase 0 spike (D4). If that doesn't work, pasting in WYSIWYG is left to the server's rules.
- **Muted UID:** a `MatchDecorator` view plugin marks `data-uid="…"` inside anchors with a class in `--muted-foreground`. No folding.
- **Badges:** a section with a `problem` shows its badge in a warning style. The tooltip names the other occurrences and has a **Renumber this one** button, which saves the open file first, calls `renumber`, and applies the returned edits as save edits.
- **Notices:** after a save with `notices`, a dismissible line under the file path says what changed ("SPEC-00012 was a copy and is now SPEC-00261"), and **Problems…** opens the dialog (D5).
- **Problems dialog** (`ProblemsDialog.tsx`): **Section problems…** in the tree's context menu, next to **Add section anchors…**. Lists the problems in the folder. Each occurrence opens its file at the section, and duplicates and collisions have **Renumber**.

### 4.8 Agent Guide

A block of text with the anchor rules for coding agents, in `shared/src/sections/agent-guide.ts` so that the client can show it and the server can write it:

> Section anchors (`<a id="SPEC-00012" data-uid="…"></a>`) give sections permanent IDs. When moving a section, move its anchor with its heading or list item. Never edit, copy or invent an `id` or `data-uid`. For a new section, write `<a id=""></a>` and Specquer assigns the ID.

- This repository's `CLAUDE.md` gets the block in Phase 5.
- **Add section anchors** offers to append it to the root folder's `AGENTS.md` (created if missing), between marker comments so it is added only once. Specquer never changes the file without that confirmation (D6).

## 5. Phases

Each phase lists its tasks and what "done" means. Tests are written within each phase.

### Phase 0 - Spikes

1. **The cost of an up-to-date index.** Time `scanFiles` on this repository, and on a generated tree of 2,000 sectioned files, when nothing changed. *Done when* the numbers are known and D3 is confirmed or changed.
2. **WYSIWYG paste** (D4). A Milkdown `transformPasted` hook that rewrites pasted anchors. *Done when* a paste in WYSIWYG turns a duplicate anchor into a placeholder, or the fallback is chosen.

### Phase 1 - Anchors and Recognition (`shared`)

- `uids.ts` (§4.1); `FoundAnchor` and `FoundSection` with UIDs; the root anchor rule with `isDocumentUid`; `analyzeBody` with stray anchors; `hasConflictMarkers`; `AnchorPlan` with `ids` and `uids`; `rootAnchorText(id, uid)`.
- Tests in `sections.test.ts`: `data-uid` in every anchor form; adding and replacing it; attribute order; the root anchor with and without a recorded UID, and with the blank line deleted; strays in each position; conflict markers versus setext headings; stability (a second run makes no edits). Update `preview.test.ts`.
- *Done when* `bun test shared` and the type-check pass.

### Phase 2 - Data Files and Reconciliation (`server`)

- Data files with root entries and `retired`; `changed()`; reading again in `load` (§4.3).
- `reconcile` per §4.4, with a test per row of the table, plus frozen documents, restores across a write, and merge leftovers in `retired`.
- *Done when* the reconciliation and data tests pass, including a test that a data file changed on disk is used by the next save.

### Phase 3 - Server Integration and API

- The stat pass before save, create, anchoring, problems and renumbering. Conflict-marker saves. Notices in `SaveResult`. 12-character UIDs. `problems` and `renumber` with their routes.
- *Done when* `sections-api.test.ts` covers:
  - an agent's new ID in another file isn't issued again
  - a pull that changes `sections.yaml` while the server runs
  - an edited ID put back
  - a copy within a document renumbered, with a notice
  - a copy across documents reported and then renumbered on request
  - a collision between two branches' entries
  - a reused retired ID
  - a restored section keeping its UID
  - a file with conflict markers saved as sent

### Phase 4 - Client

- Paste handling, muted UIDs, problem badges with **Renumber this one**, notices, the problems dialog.
- *Done when* component tests cover the badge states, the dialog and the paste filter, and `e2e/sections.spec.ts` shows:
  - copying a section within a document gives a placeholder that becomes a new ID on save
  - copying to another document does the same
  - a cut and paste keeps the ID
  - a duplicate created outside Specquer is reported and renumbered from the badge

### Phase 5 - Agent Guide

- The guide text, its block in this repository's `CLAUDE.md`, and the `AGENTS.md` offer in **Add section anchors** (§4.8).
- *Done when* a component test covers the offer and an API test shows the block is appended once.

### Phase 6 - Documentation

- Link the analysis and this plan in the VitePress sidebar (done while planning).
- **[Data Architecture](/specifications/data-architecture) §2:**
  - §2.1: the model table, with section UID and document ID merged, and stray anchors
  - §2.2: the recognition rules and the anchor forms with `data-uid`
  - §2.4: the data files, with root entries, `retired` and reading again
  - §2.5: reconciliation rewritten as the table in §4.4, with what is fixed automatically and what is reported
  - §2.6: the section index table, with the stat pass, conflict markers, problems and renumbering
  - §2.7: paste handling, muted UIDs, problem badges, notices and the problems dialog
  - §2.8: the tests
- **[Server Requirements](/specifications/server-requirements):** §4 (saving: notices, conflict markers) and §7 (the data files read again, the up-to-date index, duplicates reported). New routes in the route tables.
- **[Client Requirements](/specifications/client-requirements):** the badge section, paste handling, the muted UID, notices, **Section problems…**, and the agent guide offer in **Add section anchors**.
- **[Information Architecture](/specifications/info-architecture):** the Section row and a Section UID row; `AGENTS.md` in the folder layout as optional.
- **[Security](/specifications/security):** a file with conflict markers is never anchored; renumbering a duplicate rewrites a file only on the user's request; `AGENTS.md` is written only with confirmation.
- **[Technical Architecture](/specifications/technical-architecture):** 12-character CUID2s and the sections module's new parts.
- `CLAUDE.md`: the sections module description (problems, renumbering, data files read again), and the agent guide block from Phase 5.
- A Step 003 implementation status section at the end of this plan.

## 6. Decision Points

Taken while planning; each is _Proposed_ and the work proceeds on it unless changed.

- **D1. Root anchor recognition without `data-document-id`.** _Proposed:_ the rule for anchors written before document IDs (no heading on the very next line), plus a recorded document UID. `analyzeBody` takes `isDocumentUid` as an option, so `shared` stays free of data files. Without the option (the client, the preview) only the layout rule applies.
- **D2. Root sections in `sections.yaml`.** _Proposed:_ an entry keyed by the document ID, with `documentId` equal to the key, so root sections follow the same rules as other sections. The analysis's first draft had none; it was changed to match.
- **D3. When the index is brought up to date.** _Proposed:_ the stat pass before every operation that issues IDs, settles duplicates or reports problems. If Phase 0 shows it is too slow for large trees, skip it when the last pass was under two seconds ago and the tree's Git index hasn't changed.
- **D4. WYSIWYG paste.** _Proposed:_ handled if the spike works; otherwise only the text editor converts pasted anchors, and the server's rules cover WYSIWYG.
- **D5. Where notices appear.** _Proposed:_ a dismissible line under the file path, since there is no toast component, and none is needed for one kind of message.
- **D6. The agent guide's file.** _Proposed:_ `AGENTS.md` at the root folder, the name most coding agents read, offered from **Add section anchors**. This repository puts it in `CLAUDE.md`, which it already has.
- **D7. Stray anchors.** _Proposed:_ reported only. A quick fix that moves a stray anchor to the next heading is left for later, because guessing the intended heading wrongly is worse than leaving the anchor.

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The stat pass slows saves on large trees | Slower autosave | Phase 0 measurement; D3 fallback |
| Duplicates are no longer renumbered on save | Two sections share an ID until someone acts | Badges, notices and the problems dialog make them visible; the recorded occurrence keeps resolving links |
| Paste handling turns an intended move into a copy | A moved section gets a new ID | Only IDs that still exist elsewhere are converted, and the cut has removed the original by then |
| An agent ignores the guide | Mangled anchors | The rules in §4.4 detect most damage; misplaced anchors (E6 in the analysis) stay undetectable |
| Reading the data files again picks up a half-written file from Git | A damaged read | Damaged files are already tolerated and rebuilt; the next read, after the next change, recovers |

## 8. Implementation Status

All phases were carried out in October 2026. What differs from the plan, or was learned doing it:

1. **Spike 1 (D3).** An unchanged scan takes about 55 ms on this repository and about 200 ms on a generated tree of 2,000 sectioned files with 40,000 sections, after a first scan of about 5 s. That is acceptable before a save, so the D3 fallback wasn't needed.
2. **Spike 2 (D4).** WYSIWYG paste handling works through ProseMirror's `transformPasted`, but only for IDs the open document holds: the hook is synchronous, so the lookup in other documents stays in the text editor, and the server reports copies from other documents pasted in WYSIWYG.
3. **Copies of whole files.** The table in §4.4 reports duplicates across documents. A document whose ID another file holds is a copy, though (the recorded path keeps the ID), so all its sections are renumbered automatically, as in Step 002, rather than reported one by one.
4. **Identical copies within a document.** A copy with the same ID and UID can't be told from the original, so the first occurrence keeps the ID. Paste handling covers copies made in Specquer; a copy pasted above the original in another editor still takes the ID.
5. **The preview's root anchor.** The preview used `data-document-id` to tell the root anchor from a heading's. It now uses source positions (a heading on the very next line), as `findSections` does.
6. **Badges** take the UID from the anchor's `data-uid`, which the sanitizer passes through, so a badge identifies its occurrence even when one document holds an ID twice. The preview loads the document's sections when its anchors or the saved version change, for the problem state.
7. **Data files read again.** A re-read also forgets the text last written for each file, so a file deleted by a branch switch is written again even if its content is unchanged.
8. **The agent guide** in this repository's `CLAUDE.md` sits under a `## Section anchors` heading, with the same text and markers as the `AGENTS.md` block.
9. **Tests.** End-to-end tests pass on Chrome and WebKit. The release build was checked: it creates sectioned files with 12-character UIDs.
