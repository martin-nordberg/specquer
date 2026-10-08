# Section Anchor Conflicts

_Notes from October 2026._

Section anchors are ordinary text in Markdown files. Specquer can't stop other editors, coding agents and Git from copying, changing, moving or deleting them. This note lists the conflicts that can arise and what Specquer does about each today. It then asks whether putting each section's CUID2 in its anchor would help, for example:

```html
<a id="SPEC-00012" data-uid="k1v2u0xwq8y7"></a>
```

The section ID stays the anchor's `id`, since it is the human-readable part of URLs. The CUID2 would be an extra attribute.

**Short answer:** yes, put the CUID2 in the anchor. It doesn't create new kinds of conflict: copies, branch collisions, edited IDs and reused IDs already happen today. Without the CUID2, Specquer can't tell them apart, so it guesses by position or file order. With it, Specquer can tell which case it is looking at. The main cost is noise in the raw text. Some important problems don't depend on this choice, though, and two of them are bugs in the current code (§4). Recommendations are in §6, with one for each conflict in §6.2. The recommendations were accepted, and §7 records the decisions.

## 1. How Identity Works Now

| Thing | Where its identity lives | Recoverable if the data files are lost? |
|---|---|---|
| Document | `data-document-id` in the root anchor, and `documents.yaml` | Yes, from the files |
| Section ID | `id` in the anchor, and `<prefix>/sections.yaml` | Yes, from the files |
| Section UID (CUID2) | Only in `sections.yaml`, attached to a section ID | **No** |
| Highest number issued | `lastSequence` in `sections.yaml` | Only up to the highest ID still in a file |

So a section's real identity today is the text of its section ID. The CUID2 is only a label attached to that ID, and it is the one piece of section data that can't be rebuilt from the documents. The documents travel with every copy, merge and cherry-pick. The data files are written lazily, often in a later commit.

Document IDs were put in the root anchor for exactly this reason: so that a document keeps its identity when it is moved or renamed outside Specquer. Sections have the same problem but not the same solution.

## 2. What Changes Anchors Outside Specquer

- **People in other editors:** copy and paste, search and replace, deleting, tidying up numbers.
- **Coding agents:** they rewrite whole files, invent plausible IDs, drop anchors, copy a neighboring anchor when adding a section, and move text without its anchor.
- **Git:** merges, rebases, cherry-picks, reverts, restores and branch switches, sometimes while Specquer is running.
- **File operations:** copying, moving into or out of the configured folders, and deleting and restoring.
- **Formatters** such as Prettier and markdownlint, and Specquer's own WYSIWYG editor. These keep raw HTML, so they are a low risk.

## 3. The Conflicts

"Now" is what the current code does. The last column says whether a CUID2 in the anchor would help.

### 3.1 Editing

| # | Situation | Now | Problem | Inline UID |
|---|---|---|---|---|
| E1 | **A section copied within a document** (as a template) | The first occurrence keeps the ID and later ones are renumbered | If the copy is pasted *above* the original, the copy keeps the ID. The original is renumbered, and existing links now go to the copy | No help: the UID is copied too. Paste handling fixes it (§6.1, item 4) |
| E2 | **A section moved to another document, with the target written first** (an external editor, or an agent writing B before A) | The document that `sections.yaml` records keeps the ID, so the moved copy in B is renumbered when B is saved. When A is then saved without the section, the original ID is gone | The move becomes a new section, and links break | No help (both copies are the same). See §6.2 |
| E3 | **An anchor's ID edited** (a typo, someone renumbering "neatly", an agent) | The old entry is dropped and its CUID2 lost. The new ID is accepted, even if it was retired, or treated as a duplicate | The section loses its CUID2, and links to the old ID break | **Helps:** the UID shows it's a known section whose ID changed. Specquer can put the recorded ID back, as the rule "a section ID never changes" implies, and list links to the old ID |
| E4 | **A retired ID used again** (typed, invented by an agent, or restored from history) | Accepted (Step 002 open question 4). A restore can't be told apart from reuse | Old links now go to different content, which breaks the rule that numbers are never reused | **Helps,** together with a list of retired IDs: a restored section brings its old UID, but reuse has none or another |
| E5 | **An anchor separated from its section:** text inserted between the anchor and the heading, a heading moved into a list or block quote, or a list indented under an item | The section loses its anchor without notice. The stray anchor is ignored, and the heading gets a new ID on save | Links go to the stray anchor's position, and the section's identity is gone | No help. A check for stray anchors would find it (§6.1, item 6) |
| E6 | **An anchor moved to the wrong heading** (an agent reorders sections but leaves the anchors where they were) | Not detected | The ID, and its links and future metadata, now belong to different content | No help. Nothing in the anchors can show this; see §6.2 |
| E7 | **An anchor deleted** (an agent rewrite, or by hand) | The entry is dropped at the next write and the number retired; the section gets a new ID on save | Links break | Only if the section is restored later, with retired IDs recorded |
| E8 | **A UID copied to a new section** (an agent imitating a neighbor) | Not applicable today | A new kind of duplicate | It has an obvious rule: the occurrence with the recorded ID keeps the UID, and the others get new UIDs |

### 3.2 Files and Configuration

| # | Situation | Now | Inline UID |
|---|---|---|---|
| F1 | A file copied | Handled by the document ID: the copy gets a new document ID, and its sections are duplicates that get renumbered | Same handling, and the UIDs show they are copies rather than collisions |
| F2 | A file moved out of the configured folders and back, or deleted and restored with `git restore` | Its entries are dropped at the next write; when it comes back, its sections get **new CUID2s** | **Helps:** the UIDs come back with the text |
| F3 | A file copied and the original then deleted (how agents often "move" files) | Handled. Fixes are only written on save, so a short-lived copy settles back into a move | Same |

### 3.3 Git

| # | Situation | Now | Problem | Inline UID |
|---|---|---|---|---|
| G1 | **Two branches issue the same number.** With sequential numbers this is certain to happen sooner or later | After the merge, the entry that comes first in `sections.yaml` (usually the branch being merged into) keeps the ID, and the other is renumbered on its next save | Links written on the other branch now go, without warning, to the wrong section | **Helps detection:** different UIDs mean a collision, not a copy. Specquer can report it and list the links to check. It can't fix links by itself, because links carry only the ID |
| G2 | **Two clones create different CUID2s for the same section.** For example, a section was added outside Specquer and committed without the data files, and two people's Specquer instances each add an entry | After the merge there are two entries with one ID, and the earlier one wins | Future metadata keyed by the losing CUID2 is orphaned | **Solves it:** the UID is created once, in the anchor, and travels with the text |
| G3 | **Content and data in different commits.** Data files are written at the next Specquer write, so a cherry-pick, revert or interactive rebase can carry the content without its data | Reconciliation follows the content, except that CUID2s are lost or created again | Identity depends on which commits travel together | **Solves it:** a content commit is complete on its own |
| G4 | **A pull or branch switch while Specquer runs** | **Bug:** `SectionIndex.load` reads the data files once per session. The next write saves the in-memory data, reconciled with the current documents | Teammates' entries get new CUID2s; a higher `lastSequence` from the pull is lost, so their retired numbers can be issued again | Limits the damage (UIDs recoverable), but `lastSequence` still needs the fix |
| G5 | **Conflict markers inside a document** during an unresolved merge | Both sides' anchors are found, and a save in Specquer renumbers one of them | The resolution is decided before the user has resolved the merge | No help. Don't anchor such a file (§6.1, item 3) |
| G6 | Conflicting entries in `sections.yaml` | Read with the conflict markers dropped, and the earlier entry wins | Low risk: the entries are mostly derived | Lower still: the entries can be rebuilt from the documents (§5.3) |

## 4. Problems That Don't Depend on the UID Choice

- **S1. The index of other documents goes stale. (Bug.)** Specquer scans the files only at startup and when the tree reloads, which happens only after Specquer itself creates, renames or deletes something. A save indexes only the file being saved. So duplicates are resolved and numbers issued using an out-of-date view of every other file. If an agent adds `SPEC-00300` elsewhere, Specquer can issue `SPEC-00300` again. The fix is cheap: the scan's modification-time and size cache makes a full check of the files fast, so do one before issuing numbers or settling duplicates.
- **S2. The data files are never read again (G4). (Bug.)** Read them again when their modification time changes, as is already done for the configuration.
- **S3. Fixes happen without telling the user.** Renumbering happens on save without notice, and duplicates in files that aren't opened stay indefinitely.
- **S4. Links are never updated or checked.** Renumbering is safe for a copy, because links point to the original. For a collision (G1) or an edited ID (E3), it leaves links pointing to the wrong section or nowhere.
- **S5. Duplicates within a document are settled by position (E1).** An outside editor gives no better signal than position. Specquer's own editor does: it can tell a paste from typing.

## 5. Putting the UID in the Anchor

### 5.1 Design

- `data-uid="<CUID2>"` on every section anchor. New CUID2s are 12 characters long (`init({ length: 12 })` in `@paralleldrive/cuid2`).
- **The document ID and the root section's UID are one CUID2.** The root anchor carries it as `data-uid`, like every other anchor, and `data-document-id` goes away:
  `<a id="SPEC-00001" data-uid="tz4a98xxat96"></a>`.
  A document's identity is the identity of its root section. `documents.yaml` keeps mapping that CUID2 to the document's path. In `sections.yaml`, the root section's entry is keyed by the same CUID2, so root sections follow the same rules as the others.
- **Recognizing the root anchor.** `data-document-id` no longer marks the root anchor, because every anchor now has a `data-uid`. The first block is the root anchor when it is a paragraph holding only an anchor, unless the heading on the very next line follows it: this is today's rule for root anchors written before document IDs. Specquer writes the root anchor followed by a blank line. If that blank line is deleted, the anchor would read as the first heading's, but a UID recorded in `documents.yaml` still marks it as the root anchor.
- **The UID is the section's identity; the ID is its name.** An anchor without a UID (written before this change, or with its UID deleted) takes the UID recorded for its ID, as all anchors do today. An invalid UID counts as missing.
- New anchors get both at once. Existing anchors get their UID from `sections.yaml`, so current CUID2s are kept. As with other fixes, files are rewritten only on save or by **Add section anchors**, never by a scan.
- **No migration of document IDs.** `data-document-id` is no longer read. Specquer hasn't been used outside this repository, and the existing document IDs will be deleted by hand, so nothing needs to carry over. The root sections' own CUID2s in `sections.yaml` are dropped as well; nothing is keyed by them yet.

### 5.2 Rules by Combination

| Found | Meaning | Action |
|---|---|---|
| A known ID with its own UID | Normal | — |
| The same ID and UID twice | A copy (E1, F1) | The recorded or first occurrence keeps both; the copy gets a new ID and a new UID |
| The same ID with different UIDs | A collision (G1) | The recorded occurrence keeps the ID; the other is renumbered. Report it, with the links to that ID |
| A known UID with another ID | An edited ID (E3) | Put the recorded ID back, unless another section now holds it |
| The same UID with different IDs | A copied UID (E8), or a copy renumbered by hand | The occurrence with the recorded ID keeps the UID; the others get new UIDs |
| A retired ID with its old UID | A restore (E4, F2) | Accept it |
| A retired ID with no UID or another UID | Reuse (E4) | Renumber it |
| A new ID and a new UID | A section added elsewhere, on another branch or by hand | Record it |

Every one of these situations happens today. The UID only makes them distinguishable. The one new situation is a copied UID, and its rule is simple, so the UID adds few rules and removes guessing.

### 5.3 Effect on the Data Files

With UIDs in the documents, every entry in `sections.yaml` except `lastSequence` can be rebuilt from the files, so losing or damaging the file no longer loses identity. The entries stay, though, as the last known state. The rules in §5.2 need it: "the recorded ID" and "the recorded occurrence" refer to it. A `retired` list (UID and ID, appended) joins them, so restores and reuse can be told apart. Future metadata (status, review comments, summaries) can be kept in side files keyed by UID. Section-level history also becomes possible: `git log -S <uid>` follows a section across edits, moves and renames, which serves the "granular change history" purpose in the Step 002 requirements.

### 5.4 Costs

- **Noise in the source:** 24 more characters per anchor with 12-character CUID2s, which is heaviest on sectioned list items:
  `* <a id="REQ-00752" data-uid="tz4a98xxat96"></a> Some requirement`.
  Rendered output on GitHub and the docs site doesn't change. Specquer's text editor shows the attribute in a muted color but doesn't fold or hide it (§7, decision 4). The root anchor gets no longer, because `data-uid` replaces `data-document-id`.
- **One more token for agents to damage.** Damage can be detected, though: an unknown UID is a new section, and a copied UID follows the rule in §5.2.
- **Things it doesn't fix:** copies within a document (E1), the order of a move (E2), separated or misplaced anchors (E5, E6), deleted anchors (E7) and links (S4).

## 6. Recommendations

### 6.1 In Order of Value for the Effort

1. Read the data files again when they change on disk (S2, G4).
2. Bring the index of every sectioned file up to date before issuing numbers or settling duplicates on save (S1).
3. Leave files that contain conflict markers alone: save them as sent, without anchoring, and show a warning (G5).
4. **Paste handling in Specquer's editors:** a pasted anchor whose ID still exists elsewhere becomes a placeholder. A cut followed by a paste keeps its ID, because the original is gone by then (E1, S5).
5. **Report problems instead of just fixing them:** a list of duplicates, collisions, stray anchors, reused retired IDs, and the renumbering done on save (S3).
6. Find stray anchors in the section ID format outside section positions (E5).
7. **Write down the anchor rules for coding agents:** a short guide in the repository that agents read, such as a paragraph in `CLAUDE.md` or `AGENTS.md`, which **Add section anchors** could offer to create. It would say: move an anchor together with its heading; never edit, copy or invent IDs or UIDs; use `<a id=""></a>` for a new section. This is the only defense against E6, and it reduces E3, E4, E7 and E8.
8. Put the UID in the anchor, with the rules in §5.2, and retired IDs recorded in `sections.yaml`. The root anchor's UID is also the document ID (§5.1).
9. Link checking (S4), which is needed before collision renumbering can ever be safe. It is a larger, separate step.

### 6.2 For Each Conflict

| # | Recommendation |
|---|---|
| E1 | Paste handling (item 4). From outside editors, keep the first-occurrence rule but report the renumbering |
| E2 | Up-to-date index (item 2). For a duplicate across documents, keep the ID in both and mark both badges as duplicates until one disappears (a move in progress) or the user picks which one keeps it |
| E3 | With UIDs: put the recorded ID back. Until then: report it (item 5) |
| E4 | Record retired IDs (item 8). With UIDs: accept restores and renumber reuse. Until then: report a retired ID that comes back |
| E5 | Report stray anchors (item 6), with a quick fix that moves the anchor back to the next heading or list item |
| E6 | Agent guide (item 7). Detection isn't worth building now |
| E7 | Agent guide (item 7) and recorded retired IDs, so that a later restore is recognized. Once there is link checking, report links to the deleted section |
| E8 | The copied-UID rule in §5.2 |
| F1 | No change; with UIDs, the copies are reported as copies |
| F2 | UIDs in anchors (item 8) |
| F3 | No change. Keep fixes lazy: it is what makes this case work |
| G1 | Report the collision with the links to the ID (item 5) and renumber only after the user confirms. Don't give up readable sequential IDs to avoid collisions; up-to-date indexes make them rarer, and reporting makes them safe |
| G2 | UIDs in anchors (item 8) |
| G3 | UIDs in anchors (item 8) |
| G4 | Read the data files again (item 1) |
| G5 | Skip anchoring (item 3) |
| G6 | No change: with UIDs in the anchors, the entries can be rebuilt from the documents (§5.3) |

## 7. Decisions

The recommendations in §6 were accepted. These questions were settled along with them:

1. **An edited ID (E3) is put back.** The requirements say an ID never changes, and links depend on that. Someone who really wants a different ID can add a new section and delete the old one.
2. **Copies within one document are renumbered automatically on save**, as now; that is safe because links point to the original. Duplicates across documents and collisions are shown as problems and renumbered only when the user confirms, because guessing wrong breaks links (E2, G1).
3. **The attribute is `data-uid`, and new CUID2s are 12 characters long.** Collisions among a repository's sections are still negligible. The document ID and the root section's UID are one CUID2, in the root anchor's `data-uid` (§5.1).
4. **No folding in the text editor:** hidden text is easy to delete without noticing. The `data-uid` attribute is shown in a muted color instead, so the eye skips it but it stays visible and editable.
