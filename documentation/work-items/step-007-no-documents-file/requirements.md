<a id=""></a>

<a id=""></a>
# Step 007 - Without documents.yaml

_Requirements and plan for removing `.specquer/shared/documents.yaml`. Drafted October 2026._

<a id=""></a>
## 1. Summary

`.specquer/shared/documents.yaml` maps each document ID (the root anchor's UID) to the document's path. Most of what it records is already in `sections.yaml`, and its paths change only when Specquer writes the data files. After a rename, copy or delete outside Specquer (Git, an editor, a coding agent), it no longer matches the files. That mismatch does no damage, because every entry is rebuilt from the documents on the next write. It does make commits noisy, and it causes merge conflicts for no benefit.

Step 007 removes the file. Each of its three uses gets another source:

| Use today | Instead |
| --- | --- |
| Telling a root anchor directly followed by a heading from that heading's anchor (`isDocumentUid`) | `sections.yaml`: a UID whose entry's `documentId` is the UID itself is a document ID |
| Giving a file whose root anchor was lost the document ID recorded for its path | The document ID that the file's other sections record in `sections.yaml` |
| Deciding which of two files with one document ID (a whole file copied) keeps it | Where Specquer last saw the document in this session; else Git; else the user decides in **Section problems** |

<a id=""></a>
## 2. Precedence

Step 007 takes precedence over the specifications and earlier steps where they conflict:

| Topic | Before | Step 007 (wins) |
|---|---|---|
| Data files | `documents.yaml` and `<prefix>/sections.yaml` | `<prefix>/sections.yaml` only |
| A whole file copied | The file at the recorded path keeps the document ID, or else the first by path; the copy is renumbered at once, with a notice | As before when Specquer or Git can tell which file is the original; otherwise reported, and nothing changes until the user decides (R3) |
| A lost root anchor | The document ID recorded for the file's path | The document ID that the file's sections record (R2) |
| Renames | Update the paths in the index and in `documents.yaml` | Update the paths in the index |

<a id=""></a>
## 3. Requirements

<a id=""></a>
### R1. Recognizing Root Anchors

1. A UID is a document ID when a live entry in any `sections.yaml` has that UID as its key and as its `documentId`. That holds for every root section, which is recorded keyed by its own UID.
2. `analyzeBody`'s `isDocumentUid` uses this rule. Root sections only in the running index, not yet written to a data file, count too.
3. A root anchor directly followed by a heading in a document with no recorded entry (new, or retired) falls back to today's rule: it is that heading's anchor. This is the case today for a document missing from `documents.yaml`.

<a id=""></a>
### R2. A Lost Root Anchor

1. When a sectioned file has no root anchor (or one without a UID), its document ID is the `documentId` its sections' entries record most often, provided no other file holds that ID. Otherwise it gets a new document ID, as today.
2. Its root section then gets its ID back the usual way: the recorded entry for that UID.

<a id=""></a>
### R3. A Whole File Copied

When several files hold one document ID, the original keeps it, decided in this order:

1. **This session:** `SectionIndex` remembers, for each document ID, the path where it last held that ID alone (from scans, saves, creates and renames, and following renames of folders). That file is the original. This covers a copy made while Specquer runs.
2. **Git:** otherwise, if exactly one of the files is tracked in Git's index (`git ls-files --cached`), it is the original. This covers a copy made before Specquer started and not yet committed.
3. **The user:** otherwise (no Git, both files tracked, or neither), nothing is decided automatically:
   - **Section problems** lists a **copied document** problem naming the files, with **Renumber this copy** on each. It renumbers every section of that file, its root section included, as the copy is renumbered today.
   - Until the user decides, neither file is anchored. Saving either works but adds or fixes no anchors, as with merge conflict markers. The tree's files and badges still show.
   - The first file by path stands in for the document meanwhile, so links and lookups by section ID resolve to it.

When the original is known (rules 1 and 2), the copies are renumbered on their next save or by **Add section anchors**, with the notice they get today.

<a id=""></a>
### R4. The File Itself

1. Specquer no longer reads or writes `.specquer/shared/documents.yaml`, and no longer watches it for changes.
2. An existing `documents.yaml` is ignored and left in place; the commit that brings Step 007 into a repository deletes it. Specquer doesn't delete it, since the server writes only files the user changes and its own data files.
3. Reconciliation's results don't depend on whether the file exists, so branches with and without it merge cleanly once it is deleted.

<a id=""></a>
### R5. Unchanged

- Section IDs, UIDs, anchors, `sections.yaml` (its format, its `documentId` fields, `retired` and `lastSequence`), and every other reconciliation rule.
- Moves and renames outside Specquer: a document keeps its ID through its root anchor's UID wherever it is.

<a id=""></a>
## 4. Design

<a id=""></a>
### 4.1 Data (`server/src/sections/data.ts`)

- `SectionData` loses `documents`. `parseDocumentsFile`, `formatDocumentsFile` and `DOCUMENTS_FILE` go, and `DataFiles.read`, `write` and `changed` cover only the prefix folders.
- A helper, `documentIds(data)`, returns the set of UIDs recorded as their own `documentId`, for R1.

<a id=""></a>
### 4.2 Reconciliation (`server/src/sections/reconcile.ts`)

`reconcile` takes a new input, `originals: ReadonlyMap<documentId, path>`, in place of `data.documents`. The rules for documents become:

1. A document ID in one file: that file holds it.
2. A document ID in several files: the file `originals` names keeps it, and the others are copies, renumbered as today. Without one, the result lists a `copied-document` problem; none of the files get fixes, and the first by path stands in, as frozen documents do today.
3. A file without a document ID: the most frequent `documentId` among its sections' recorded entries, if free (R2), else a new one.

The result's `documents` (document ID to path, for the index) replaces the written `documents.yaml`.

<a id=""></a>
### 4.3 The Index (`server/src/sections/section-index.ts`)

- It keeps `lastSeen: Map<documentId, path>`, updated after each reconciliation for every document ID held by exactly one file, and by `renamed` and `deleted`.
- Before reconciling, it builds `originals` from `lastSeen`, and for IDs still undecided asks Git once per scan (`gitTrackedFiles(root)` in `server/src/git.ts`, a `git ls-files --cached` of the holders' paths). Not in Git, or Git missing: no answer, as `gitInfo` does today.
- `isDocumentUid` reads `documentIds(this.data)` plus the root sections in the current reconciliation.
- `renumber` accepts a whole-document request (a path, with no section ID), for **Renumber this copy**.

<a id=""></a>
### 4.4 API and Client

- `SectionProblem` gains `{ kind: "copied-document", documentId, paths }`.
- `POST /api/sections/renumber` accepts `{ path, baseVersion, document: true }`, which renumbers every section of the file (its root section included), as a copy is renumbered.
- `ProblemsDialog` lists the problem ("These files are copies of one document; renumber the copy"), with **Renumber this copy** next to each path.

<a id=""></a>
## 5. Specifications to Update

- **[Data Architecture](/specifications/data-architecture):** §2.1 (document ID), §2.2 (recognizing the root anchor), §2.4 (the data files: no `documents.yaml`), §2.5 (the document rules, R2 and R3), §2.6 (the index's `lastSeen` and the Git check), the operations table (rename and delete).
- **[Server Requirements](/specifications/server-requirements):** §7 items 2 and 5; §6 (`renumber` with `document`, the new problem).
- **[Client Requirements](/specifications/client-requirements):** §3.5, the copied-document problem.
- **[Security](/specifications/security):** §5, the data files the server writes; the Git query reads only the index.
- **[Information Architecture](/specifications/info-architecture):** the shared data row and the folder diagram.
- `CLAUDE.md`: the data files in the `sections/` description.

<a id=""></a>
## 6. Phases

<a id=""></a>
### Phase 1 - Data and Reconciliation

- `data.ts` without `documents.yaml`; `documentIds`; `reconcile` with `originals`, R2, and the copied-document problem.
- Unit tests:
  - a root anchor followed by a heading is recognized from `sections.yaml` alone;
  - a lost root anchor gets its document ID back from its sections;
  - a copy with a known original is renumbered, and one without is reported and left alone;
  - an existing `documents.yaml` changes nothing;
  - the reconciliation tests that used `documents.yaml` keep their outcomes, with `originals` in its place.
- *Done when* `bun test` passes.

<a id=""></a>
### Phase 2 - Index, Git and API

- `lastSeen`, the Git check, `isDocumentUid`, renaming and deleting, the whole-document renumber, the problem in `/api/sections/problems`.
- API tests:
  - a copy made while the server runs is renumbered on save;
  - a copy present at startup in a Git repository, with the original committed and the copy untracked, is renumbered;
  - the same outside Git is reported, and **Renumber this copy** settles it;
  - a folder renamed outside Specquer keeps every ID, with no data file listing paths.
- *Done when* the API tests pass and no test writes `documents.yaml`.

<a id=""></a>
### Phase 3 - Client and End-to-End

- The problem in `ProblemsDialog`.
- An end-to-end test: copy a file on disk outside Git while Specquer is stopped, start it, see the problem in **Section problems**, renumber the copy, and check that the original's IDs are unchanged.
- *Done when* the component and end-to-end tests pass on Chrome and WebKit.

<a id=""></a>
### Phase 4 - Documentation and This Repository

- The specifications in §5, and a Step 007 implementation status section here.
- Delete `.specquer/shared/documents.yaml` from this repository in the same commit.

<a id=""></a>
## 7. Decision Points

_Proposed_; the work proceeds on them unless they are changed.

- **D1. Copies Specquer can't place are reported, not guessed.** Guessing "first by path" renumbers the original whenever the copy's name sorts first, which is the worst outcome for links. Reporting costs a click in a case that should be rare: copying a spec file outside Specquer, outside Git or with both files committed.
- **D2. Git's index, not `HEAD`.** A file just `git add`ed counts as the original, matching what the user sees in `git status`. One `ls-files` call per scan, and only when two files share a document ID.
- **D3. The session record isn't persisted.** Persisting it would bring back a file of paths. The Git check and the problem cover restarts.
- **D4. Specquer doesn't delete the old file.** It isn't Specquer's to delete once unused; the Step 007 commit removes it here, and other repositories remove it by hand. An older Specquer that runs on the repository recreates it, which is harmless.

<a id=""></a>
## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A copy at startup outside Git | Reported instead of renumbered at once | The problem names both files; one click settles it |
| Both files committed before Specquer saw the copy | The same | The same |
| A root anchor directly followed by a heading, in a document whose root was never recorded | Read as the heading's anchor | Today's rule for documents missing from `documents.yaml`; Specquer writes a blank line after root anchors |
| Reconciliation tests depend on `documents.yaml` | Many test changes | `originals` takes its place one for one in the tests |

<a id=""></a>
## 9. Implementation Status

Phases 1 to 4 were carried out in October 2026. What differs from the plan, or was learned doing it:

1. **The renumber route** (§4.4) is a route of its own, `POST /api/sections/renumber-document` with `{ path, baseVersion }`, rather than a `document: true` variant of `/api/sections/renumber`; the two take different bodies, and separate schemas keep the typed client simple. The problem is `{ kind: "copied-document", paths }`, without the document ID, which the client doesn't need.
2. **A copy never keeps a section ID its original holds.** Choosing which occurrence of a duplicated ID keeps it looked only at `sections.yaml`, so with no entries yet (a copy found before any save) the first by path kept it, which could be the copy. Copies are now never candidates while the original holds the ID. This was wrong before Step 007 too, hidden while `documents.yaml` decided most copies.
3. **The stand-in** for an undecided copy is not anchored either: a save of either file returns `not-anchored` with `reason: "copied-document"`, and the client's notice says to renumber the copy in **Section problems**.
4. **Git** (§4.3): `gitTrackedFiles` in `server/src/git.ts` runs `git --literal-pathspecs ls-files -z --cached` on the files holding the ID; answers are cached per document ID and set of paths, so a tree load asks Git at most once per set of copies.
5. **Recognizing root anchors** reads the document IDs from `sections.yaml` plus those the last reconciliation found, so a document created in this session counts before its data file is written.
6. **Tests.** Unit and component tests pass (427); the end-to-end suite passes on Chrome and WebKit (108), with `e2e/copies.spec.ts` covering a copied document reported and renumbered from **Section problems**.
7. **This repository**: `.specquer/shared/documents.yaml` is deleted in the Step 007 commit.

