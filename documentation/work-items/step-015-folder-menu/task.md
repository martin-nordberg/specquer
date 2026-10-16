<a id="WORK-00618" data-uid="qsha9kckz1ur"></a>

<a id="WORK-00619" data-uid="rqa013mcgl2l"></a>
# Revised folder pane context menu

* Change the order of the folder context menu items as follows:
  - New file...
  - New folder...
  - (separator)
  - Rename...
  - Delete...
  - (separator)
  - Add section anchors...
  - Settings...
  - Section problems...
* "Add section anchors..." replaces the button by that name in the folder settings dialog.
  Moving it there was a UX mistake.

<a id="WORK-00620" data-uid="d9h3gl7lm7g8"></a>
# Revised file context menu

* The context menu for a file in the left pane looks like:
  - Rename...
  - Delete...
  - (separator)
  - Add section anchors...
  - Section problems...
* The two new entries apply the logic now in place for a whole folder to just that one file

<a id="WORK-00624" data-uid="fecwilyaj764"></a>
# Feedback

Points the task leaves open, each with what the plan below assumes.

**Decided in review:** treating folders and files differently by whether they hold, or are, Markdown was a mistake all around. Every folder has the same menu, and every file has the same menu; each dialog says when its option doesn't apply.

1. **"Every file" includes files other than Markdown.** Step 014 gave those files, and everything in `.specquer`, no menu at all (its R2.3). _Plan:_ they get the same menu as every other file, and the dialogs explain (item 4). What Specquer may change doesn't change: the server still refuses to rename or delete a file other than Markdown, and every route that writes still refuses `.specquer`. If "every file" was meant to cover only Markdown files, the other files keep having no menu, and item 4's rows for them go.
2. **The root folder's menu** (the empty space below the tree) has no **Rename…** or **Delete…**. _Plan:_ **New file…**, **New folder…**, separator, **Add section anchors…**, **Settings…**, **Section problems…**.
3. **The folder settings dialog's offer after a save.** When a save makes a folder sectioned, the dialog says so and offers **Add section anchors…** with **Close**. That is the moment a user most needs anchors, and the offer isn't the button the task calls a mistake. _Plan:_ removes the button from the dialog's body and keeps the offer after a save.
4. **When an option doesn't apply,** its dialog opens anyway, says why, and offers only **Close**. Most cases are known from the path alone; the two about sectioned files need the server, which already scans for both dialogs.

   | Option | Doesn't apply when | The dialog says |
   |---|---|---|
   | **Rename…**, **Delete…** | A file other than Markdown | "Specquer renames and deletes only Markdown files. Rename or delete “build.ts” outside Specquer." |
   | **Rename…**, **Delete…**, **New file…**, **New folder…**, **Settings…** | An entry in `.specquer` | "“.specquer” holds Specquer's own data, which Specquer changes itself." |
   | **Add section anchors…** | A file other than Markdown | "Only Markdown files have sections." |
   | **Add section anchors…** | A folder or Markdown file with no sectioned files (from the dry run's count) | "“notes” holds no sectioned files. Section anchors are added only in sectioned folders; see the folder's **Settings…**." |
   | **Section problems…** | A file other than Markdown, or a path with no sectioned files (from the server's count) | The same messages; problems that need no sectioned files, such as a nested `.specquer` folder, are still listed |

   **Settings…** always applies to a folder outside `.specquer`, holding Markdown or not: its type and prefix are for the files still to come too.
5. **The agent guide checkbox** (adding the rules to `AGENTS.md`) is about the whole repository. _Plan:_ offered when anchoring a folder, not a single file.
6. **Section problems for a file** lists every problem that involves the file, including the other side of it: a duplicate ID lists its occurrences in other files too, and a copied document lists both copies. That is how a folder's list already treats files outside the folder.
7. **Wording.** The dialogs name what they act on: "the sectioned files in “docs”" for a folder, "“login.md”" for a file.

<a id="WORK-00625" data-uid="y0b0a6r927cn"></a>
# Implementation Plan

<a id="WORK-00626" data-uid="l3g2yg2v7x93"></a>
## Starting Point

- **`client/src/components/FileTree.tsx`**: a folder's menu is `NewEntryItems` (**New file…**, **New folder…**, **Settings…**, **Section problems…**), a separator, then **Rename…** and **Delete…**. The root's is `NewEntryItems` alone. A Markdown file's is **Rename…** and **Delete…**. Files other than Markdown, and everything in `.specquer`, have no menu (Step 014).
- **`client/src/components/settings/FolderSettingsDialog.tsx`**: an **Add section anchors…** button under the fields, enabled while the folder is sectioned, and the same offer after a save that makes the folder sectioned. Both call `onAddAnchors`, which `App.tsx` turns into the `anchoring` state.
- **`AnchorDialog.tsx`** and **`ProblemsDialog.tsx`** take a `TreeFolder`, name it ("the root folder" or “name”), and call `api.anchorFolder(path, …)` and `api.sectionProblems(path)`.
- **The server already handles a file.** `SectionIndex.anchorFolder` and `problems` keep what `isSameOrInside(path, folder)` accepts, and a file's path accepts only itself. `anchorFolderSchema` and `sectionProblemsSchema` take any workspace path.

<a id="WORK-00627" data-uid="hrnofig4v5ov"></a>
## Design

- **The menus** are the same for every entry of a kind, built by one function from the node alone:

  | Entry | Menu |
  |---|---|
  | Folder | New file…, New folder… / Rename…, Delete… / Add section anchors…, Settings…, Section problems… |
  | Root folder | New file…, New folder… / Add section anchors…, Settings…, Section problems… |
  | File | Rename…, Delete… / Add section anchors…, Section problems… |

  Every file and folder has one, in both views, `.specquer` included (feedback 1); the `changeable` check of Step 014 goes. The icons stay: `FilePlus`, `FolderPlus`, `Pencil`, `Trash2` (destructive), `Settings`, `TriangleAlert`, and for **Add section anchors…** `Anchor` from Lucide.
- **Props:** `FileTree` gains `onAddAnchors(node: TreeNode)`, and `onShowProblems` takes a `TreeNode`.
- **What doesn't apply** (feedback 4) is decided in one place, `client/src/app/entry-actions.ts`: `notApplicable(action, node)` returns the message for a file other than Markdown or an entry in `.specquer`, using `fileKind` and `checkPath` from `shared/paths`, or `undefined`. Each dialog asks it first and, with a message, shows it with **Close** only, sending nothing to the server. A unit test covers every row of feedback 4's table.
- **Dialogs** take a `TreeNode` (`target`) instead of a `TreeFolder`:
  - **`RenameDialog`, `DeleteDialog`, `CreateDialog`** (`EntryDialogs.tsx`) and **`FolderSettingsDialog`:** the message from `notApplicable`, when there is one. `DeleteDialog` doesn't load its preview then.
  - **`AnchorDialog`:** "Add missing section anchors and correct duplicate IDs in “login.md”" for a file. The agent guide checkbox only for folders (feedback 5). When the dry run finds no sectioned files, it says so instead of "No file needs to change".
  - **`ProblemsDialog`:** names a file the same way; when the server found no sectioned files under the path, it says so above whatever else it lists.
- **The server's counts:**
  - `AnchorFolderResult` gains `sectioned: number`, the sectioned files under the path, which `anchorFolder` counts as it walks the index.
  - `GET /api/sections/problems` answers `{ problems, sectioned }`, counted the same way.
  - The routes and their parameter keep the name `folder`, with a comment that a file's path works too. Nothing else changes on the server: it keeps refusing to rename or delete files other than Markdown, and `.specquer` paths, whatever the client shows.
- **`FolderSettingsDialog`:** the button row and its help text go; the offer after a save stays (feedback 3). `onAddAnchors` is now used only by that offer.
- **`App.tsx`:** `anchoring`, `checking`, `renaming`, `deleting`, `creating` and `folderSettings` take any node from the tree's menu; `loadChanges`, `onRun` and `loadProblems` are unchanged (they take a path). A file's anchors are added after saving the open document, and the open document is reloaded if it changed, as for a folder.

<a id="WORK-00628" data-uid="p90n6dci4gxj"></a>
## Phases

1. **Menus, dialogs and the dry run's count**, with tests:
   - `notApplicable`: every row of feedback 4's table, and `undefined` for a Markdown file and an ordinary folder.
   - `FileTree`: the three menus of the table, in order, with separators, the same for an empty folder, a folder of code, a TypeScript file and `.specquer/shared/`; the callbacks receive the right node.
   - `EntryDialogs` and `FolderSettingsDialog`: the message and **Close** for a file other than Markdown and for `.specquer`, with no request sent.
   - `AnchorDialog`: a file's wording, no agent guide checkbox for a file, the message for no sectioned files.
   - `ProblemsDialog`: a file's wording, and the message for no sectioned files.
   - `FolderSettingsDialog`: no button in the body; the offer after a save still opens the anchor dialog.
   - Server: `POST /api/sections/anchor` for one file changes only that file and reports `sectioned: 1`; for a non-sectioned folder, `sectioned: 0`; `GET /api/sections/problems` for a file lists a duplicate shared with another file, and reports its count.

   _Done when_ `bun run typecheck` and `bun test` pass.
2. **End-to-end tests:**
   - `sections.spec.ts` and `settings.spec.ts` open **Add section anchors…** from the folder's menu instead of the settings dialog (`settings.spec.ts` keeps the offer after a save);
   - a new test anchors a single file from its menu and sees only that file change;
   - a new test opens **Rename…** on a TypeScript file in **All Files** and sees the message, with the file unchanged;
   - `all-files.spec.ts`, which checks that a TypeScript file has no menu, checks the menu's message instead.

   _Done when_ the suite passes on Chrome and WebKit.
3. **Documentation:**
   - Client Requirements §3 item 5 (the menus, the same for every entry; the dialogs' messages), §13 (files other than Markdown now have a menu), §3.4 (opened from a folder's or a file's menu, the agent guide for folders, the message for no sectioned files), §3.5 (for a file), §3.6 item 5 (the button removed);
   - Information Architecture (the left pane, and the agent guide's "in a folder's settings");
   - Data Architecture §2.6 and Server Requirements §6 (anchoring a folder or a file, and the count);
   - Information Architecture's left pane row, which says other files and `.specquer` have no menu;
   - Step 014's requirements, R2.3: a note that Step 015 gives every entry a menu;
   - `CLAUDE.md` if it names where **Add section anchors** lives.

   _Done when_ `docs:build` passes.

One commit per phase.

<a id="WORK-00629" data-uid="xq1vamvw8g1b"></a>
## Risks

| Risk | Mitigation |
|---|---|
| **Rename…** and **Delete…** move up the menu, where muscle memory expects **Settings…** | **Delete…** keeps the destructive color and its confirmation dialog |
| Options that do nothing for an entry are offered anyway | Each says why at once, with **Close**, and changes nothing; the messages name where to go instead (outside Specquer, or the folder's **Settings…**) |
| A client check missed lets a request through | The server's refusals stay as they are: a file other than Markdown can't be renamed or deleted, and `.specquer` is out of reach of every route that writes |
| End-to-end tests that click **Add section anchors…** in the settings dialog | Updated in phase 2; the component tests catch the dialog's change first |

<a id="WORK-00654" data-uid="a7s2d2seratc"></a>
## Implementation Status

Phases 1 to 3 were carried out in October 2026, one commit each. What differs from the plan, or was learned doing it:

1. **The dialogs don't check what applies; `App.tsx` does.** Before opening any dialog from the tree's menu, `fromMenu` asks `notApplicable`, and on a message opens one shared `NotApplicableDialog` (the action's title, the message, **Close**) instead. The rename, delete, create and folder settings dialogs are unchanged, and nothing reaches the server.
2. **The `.specquer` message** is one for every action: "Everything in .specquer is Specquer's own data, which Specquer changes itself." **Add section anchors…** and **Section problems…** use it too, since the server's path rules refuse `.specquer`.
3. **The counts** come from `SectionIndex`: `anchorFolder` returns `{ changed, sectioned }`, and `sectionedCount(path)` answers the problems route after its scan. Both count the sectioned documents the index holds under the path.
4. **The folder settings dialog** kept its paragraph explaining sectioned folders; only the button row went.
5. **Section problems for a file** was tested with a copied section in another file (a duplicate ID): without Git, a whole file copied is renumbered rather than left waiting, since the session remembers the original.
6. **Tests:** `bun run typecheck` and `bun test` (740) pass. The end-to-end suite passes on Chrome and WebKit (190). One WebKit run failed `comments.spec.ts`'s reply-and-resolve test under the full suite's load; it passed on two reruns and doesn't involve the menus.
