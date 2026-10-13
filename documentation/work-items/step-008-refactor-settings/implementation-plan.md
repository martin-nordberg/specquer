<a id=""></a>

<a id=""></a>
# Step 008 - Implementation Plan

_Plan for the [Folder Types and Prefixes requirements](requirements.md). Drafted October 2026._

<a id=""></a>
## 1. Summary

Step 008 replaces `.specquer/shared/section-prefixes.config.yaml` with a `.specquer-config.yaml` in each folder that needs one. That file holds the folder's `folderType` and `defaultPrefix`. Prefixes then come from the sections themselves:

- A new section takes its parent section's prefix.
- `<a id="XYZ-?"></a>` asks for prefix `XYZ`, for a new section or, keeping its `data-uid`, an existing one.
- Only `""` and `XYZ-?` are placeholders; other custom anchors are left alone.

There are five phases (§5):

1. the folder configuration;
2. recognizing anchors;
3. choosing prefixes in reconciliation and the index;
4. the settings API and the dialogs;
5. migration and documentation.

Decisions taken while planning are in §6, marked _Proposed_; the work proceeds on them unless they are changed.

<a id=""></a>
## 2. Precedence

The requirements' Precedence table applies. This plan adds:

| Topic | Before | Step 008 (wins) |
|---|---|---|
| Configuration reader | `PrefixConfigFile`: one file, one modification time | `FolderConfigs`: the files found by the tree listing, each with its own modification time (§4.1) |
| `GET`/`PUT /api/settings/folder` | The folder's entry in the prefix configuration | The folder's `.specquer-config.yaml`, with its own version (§4.5) |
| `POST /api/create` | `{ parent, name, kind }` | Also `prefix` for a file, `folderType` and `prefix` for a folder (§4.6) |
| What the server writes | `.md` files and files under `.specquer/` | Also `.specquer-config.yaml` in folders inside the root, and deleting it (§4.7) |

<a id=""></a>
## 3. Starting Point

- **Prefix configuration** (`server/src/sections/config.ts`):
  - `PrefixConfig` matches paths against rules, longest first, with `prefixFor`, `isSectioned`, `prefixes`, `entryFor`, `inheritedFor` and `fileKeysIn`.
  - `PrefixConfigFile` reads the one file again on a new modification time, or after `invalidate()`.
  - `SHARED_FOLDER` lives here too.
- **The index** (`server/src/sections/section-index.ts`):
  - `load()` gives the `PrefixConfig`; `knownPrefixes` is the configuration's prefixes plus those with data.
  - `anchor()` takes one prefix for the whole file (`config.prefixFor(path)`) and gives it to every new or renumbered section through `nextId(prefix)`.
  - `create()` writes `rootAnchorText(nextId(prefixFor(path)), uid)` into a new file.
  - `configChanged()` invalidates the reader.
- **Reconciliation** (`server/src/sections/reconcile.ts`): an ID with an unknown prefix is renumbered (`"unknown-prefix"`). A placeholder (`section.id === null`) gets a new UID. An edited ID whose UID is known gets its recorded ID back.
- **Anchors** (`shared/src/markdown/sections.ts`):
  - `anchorAt` reads an anchor's `id` and `data-uid`.
  - Any anchor in a section anchor's place is a section anchor or a placeholder: `sectionId` is `null` for any `rawId` that isn't a section ID, and `sectionUid` ignores a placeholder's UID.
  - `soleAnchor` accepts a paragraph holding only one anchor.
  - `FoundSection` has `depth` for headings.
- **Tree listing** (`server/src/files.ts`, `server/src/git.ts`):
  - `listMarkdownFiles` uses `git ls-files --cached --others --exclude-standard` with the pathspec `:(icase)*.md`, plus a walk of untracked folders. Without Git, it walks the whole tree, skipping `SKIPPED_FOLDERS`.
  - The index scans before every operation that issues IDs.
- **Folder settings**:
  - `server/src/settings/folder-settings.ts`: `FolderSettingsFile` reads and writes the folder's key in the prefix configuration through `YamlFile`, which keeps comments and carries versions.
  - `shared/src/settings/settings.ts`: `folderSettingSchema`, which is `inherit`, `off` or `prefix`.
  - `client/src/components/settings/FolderSettingsDialog.tsx`: the Inherited / Yes / No radio group, the prefix field, the list of file keys, **Add section anchors…**.
  - `server/src/app.ts`: the routes call `sections.configChanged()` after a write.
- **Create** (`client/src/components/EntryDialogs.tsx`): `CreateDialog` asks only for a name, for both files and folders.
- **Client anchors**: `isSectionAnchor` in `client/src/components/section-editing.ts` fades section IDs and `<a id="">`. Paste handling writes `<a id="">` placeholders in both editors.
- **Old mentions**:
  - `section-prefixes.config.yaml`: `config.ts`, `folder-settings.ts`, `FolderSettingsDialog.tsx`, `shared/src/settings/settings.ts`, the server tests, three end-to-end specs and five specifications.
  - `documents.yaml`: `data.ts`, `data.test.ts`, `sections-api.test.ts`, Data Architecture and Server Requirements.

<a id=""></a>
## 4. Proposed Design

<a id=""></a>
### 4.1 Folder Configuration (`server/src/sections/folder-config.ts`, replacing `config.ts`)

- **Shared schemas** (`shared/src/settings/settings.ts`):
  - `folderTypeSchema`: `BASELINE | CHANGE | AUXILIARY | NONSECTIONED`;
  - `isSectionedType`;
  - `FOLDER_CONFIG_FILE = ".specquer-config.yaml"`.
- **`parseFolderConfig(text, path, warn)`**:
  - It reads `folderType` and `defaultPrefix` with the `yaml` document API and drops invalid values with a warning (R1.6).
  - Other keys are kept in the file but ignored here.
- **`FolderConfig`**: the parsed files by folder, immutable.
  - `effective(folder)` gives `{ folderType, defaultPrefix, from: { folderType, defaultPrefix } }`, each key from the nearest folder at or above it that sets it (R1.3). A sectioned type without a prefix counts as not sectioned, with one warning per folder (R2.3).
  - `prefixFor(path)` and `isSectioned(path)` keep their names and meaning for a Markdown file: its folder's effective prefix, or `undefined` when the folder isn't sectioned. The index's callers stay as they are.
  - `prefixes()` gives the `defaultPrefix` values, for known prefixes (R4.6).
- **`FolderConfigs`**, the reader in place of `PrefixConfigFile`:
  - It holds the files' paths and modification times. `load()` stats the known files and reads again only those that changed.
  - The paths come from the tree listing (§4.2), refreshed on every scan; a file added by hand counts from the next scan.
  - `invalidate(folder?)` follows Specquer's own writes.
- `SHARED_FOLDER` moves to `data.ts`, its only other user. `config.ts`, `PrefixConfig` and `normalizeKey` go.

<a id=""></a>
### 4.2 Finding the Files (`server/src/files.ts`, `server/src/git.ts`)

- The listing collects the configuration files along with the Markdown files:
  - `listMarkdownFiles` becomes `listFiles()`, returning `{ markdown, configs }`;
  - Git's pathspec gains `.specquer-config.yaml` and `*/.specquer-config.yaml`;
  - the walk keeps entries named `.specquer-config.yaml`.
- The same Git-ignore rules and `SKIPPED_FOLDERS` apply, so `.git` and `node_modules` are never searched (R7.1).
- The tree's response is unchanged; only Markdown files are shown (R7.2).

<a id=""></a>
### 4.3 Recognizing Anchors (`shared/src/markdown/sections.ts`)

- **Placeholders** (R3.1, R3.2):
  - `placeholderPrefix(rawId)` gives `""` for a blank `id`, `XYZ` for `XYZ-?` (`^([A-Z][A-Z0-9]{1,4})-\?$`), and `undefined` otherwise.
  - An anchor is a section anchor when its `id` is a section ID or `placeholderPrefix` is defined; any other anchor is ignored, as anchors outside sections are.
- **`FoundSection`**:
  - It gains `requestedPrefix?: string`.
  - `uid` is the anchor's valid UID for an `XYZ-?` placeholder too (R3.3). A blank placeholder's UID stays ignored.
- **Custom anchors before a heading** (D1 of the requirements):
  - `soleAnchor` becomes `anchorParagraph`: a paragraph made only of anchors.
  - The paragraph is the heading's when its first anchor is a section anchor or placeholder.
  - When it holds only custom anchors, the heading is unanchored, with a new insertion form, `"paragraph"`: the section anchor is written at the start of that paragraph, with no new line.
  - The same applies to the root's paragraph and to a list item's first inline anchors.
- **`anchorEdits`**:
  - It writes the `"paragraph"` form.
  - It rewrites `XYZ-?` to the new ID, keeping the `data-uid` when the plan keeps the UID.
- **Clients**: `isSectionAnchor` and the WYSIWYG editor's paste handling recognize `XYZ-?` as a placeholder, so it fades and a pasted copy is still turned into `<a id="">`.

<a id=""></a>
### 4.4 Choosing Prefixes (`server/src/sections/reconcile.ts`, `section-index.ts`)

- **Prefixes in `anchor()`**:
  - `sectionPrefixes(sections, rootPrefix)` works out each section's prefix top-down (R4.1–R4.4), as a pure function next to `reconcile`.
  - Root: its own ID's prefix if known, else its requested prefix, else the folder's `defaultPrefix`.
  - Heading: likewise, else the prefix of the nearest earlier heading with a smaller `depth`, else the root's.
  - List item: likewise, else the prefix of the heading section holding it.
  - "Its own ID's prefix" covers sections that keep or are renumbered from a known prefix (R4.5). An unknown prefix falls through to the parent's (R4.6).
- **ID allocation**: `ids` uses `nextId(prefixes[index])` in place of the file's one prefix. The same goes for `renumber` and `renumberDocument` (**Renumber this copy**).
- **Reconciliation**:
  - A placeholder with a requested prefix and a UID that no other section holds is a prefix change: the occurrence keeps its UID, and the fix renumbers it with a new reason, `"prefix-requested"`.
  - If the UID is held elsewhere, it gets a new UID, as a copy does.
  - The UID's `sections.yaml` entry moves to the new ID's prefix in the rebuilt data; the old ID isn't retired, since the UID lives on. `lastSequence` already prevents reuse.
- **Notice**: `renumbered` with `reason: "prefix-requested"` ("SPEC-00012 is now XYZ-00004"), which the client's notice text gains.
- **`create`**: `create(parent, name, kind, options)` takes `prefix` for a file, defaulting to the folder's, and writes the root anchor with it. For a folder it takes `folderType` and `prefix` and writes the folder's file through §4.5's writer when they differ from the inherited values (R6.2).

<a id=""></a>
### 4.5 Settings API (`server/src/settings/folder-settings.ts`, `shared/src/api/`)

- **`FolderSettings`** (`GET /api/settings/folder`) becomes:
  - `own`: `{ folderType?, defaultPrefix? }`, the folder's own file;
  - `inherited`: per key, the value and where it comes from;
  - `version`: the folder file's version, `""` when missing;
  - `error`, when the file isn't valid YAML.
  - `fileKeys` goes.
- **`folderSettingSchema`** becomes `{ folderType: FolderType | "inherit", defaultPrefix: string | "inherit" }`, with the prefix checked by `isPrefix`.
- **`FolderSettingsFile.write`**:
  - It uses one `YamlFile` per folder (`<folder>/.specquer-config.yaml`).
  - It sets or deletes the two keys, keeping other keys and comments.
  - It deletes the file when no keys remain (R1.5), and writes nothing for a missing file when both are `inherit`.
  - `YamlFile` gains `remove(baseVersion)`, with the same version check.
- After a write, `app.ts` calls `sections.configChanged()` as now.
- The `PUT` route answers `"conflict"` as now when the folder's file changed (R6.4). Folders have separate versions, so they never conflict with each other.

<a id=""></a>
### 4.6 Dialogs (`client/src/components/`)

- **`FolderSettingsDialog`**:
  - **Type:** a radio group: Inherited (from *folder*: *type*), Baseline, Change, Auxiliary, Non-sectioned, each with a one-line description from R2.1.
  - **Prefix:** shown when the effective type is sectioned, with **Inherited** (from *folder*: *prefix*) or its own value. It is validated and upper-cased as in Step 006.
  - **Behavior:** saving and the status messages ("The folder is sectioned now", "The anchors stay in its files"), the conflict reload and **Add section anchors…** stay. The file-keys list goes.
  - **Text:** `PREFIX_FILE` goes; the help text names `.specquer-config.yaml`.
- **`CreateDialog`** (`EntryDialogs.tsx`) gets the folder's effective settings (`api.folderSettings(parent)`) when it opens:
  - **New file in a sectioned folder:** a **Prefix** field filled with the default.
  - **New folder:** the type radio group and the prefix field, filled with the inherited values.
  - **Sending:** the fields are sent with `create` only when changed.
- **Shared:** the type and prefix fields move into a component used by both dialogs (`settings/FolderFields.tsx`).

<a id=""></a>
### 4.7 Security (`server/src/files.ts`)

- A write helper, `writeFolderConfig(folder, text)` and `removeFolderConfig(folder)`, confines writes as R7.4 requires:
  - the folder must exist;
  - its real path must be inside the root's real path;
  - the target must not be a symbolic link;
  - the name is fixed.
- `YamlFile` for folder files goes through it, not through raw paths.
- Security §5's list of files the server writes gains these files.

<a id=""></a>
## 5. Phases

<a id=""></a>
### Phase 1 - Folder Configuration

- The shared schemas; `folder-config.ts`; the listing of §4.2; the index on `FolderConfigs`. For now, the old file isn't read.
- The test fixtures that write `section-prefixes.config.yaml` change to folder files, through a helper `folderConfig(folder, prefix, type = "BASELINE")` in the server tests and in `e2e/fixtures.ts`.
- Unit tests:
  - each key is inherited separately;
  - a sectioned type without a prefix is not sectioned and warns;
  - `NONSECTIONED` switches off a folder inside a sectioned one;
  - invalid YAML or values are ignored with a warning;
  - a file is read again only when its modification time changes;
  - a file added by hand counts after the next scan;
  - Git-ignored folders and `node_modules` are not searched.
- *Done when* `bun test` passes with every existing section test running on folder files.

<a id=""></a>
### Phase 2 - Recognizing Anchors

- §4.3 in `sections.ts`, `isSectionAnchor` and paste handling.
- Unit tests:
  - `""` and `XYZ-?` are placeholders; `intro`, `xyz-?`, `TODO` and `XY-?X` are not;
  - an `XYZ-?` placeholder keeps its UID;
  - `<a id="intro"></a>` before a heading gets the section anchor at the start of its paragraph, which is then recognized again unchanged (round trip);
  - the same for the root and a list item;
  - the existing recognition tests keep their outcomes.
- *Done when* `bun test` passes.

<a id=""></a>
### Phase 3 - Choosing Prefixes

- `sectionPrefixes`, allocation by section, the prefix-change rule in `reconcile`, the notice, and `create` with a prefix.
- Unit and API tests:
  - a new subsection under an `XYZ` section gets `XYZ`;
  - a new heading under a new `XYZ-?` heading in the same save gets `XYZ`;
  - a list item takes its heading's prefix;
  - `XYZ-?` with a `data-uid` keeps the UID, gets `XYZ-00001`, and its subsections keep their IDs;
  - `XYZ-?` with a UID another file holds gets a new UID;
  - an edited section ID is still restored;
  - a duplicate and **Renumber this copy** keep their own prefixes;
  - an unknown-prefix ID goes to the parent's prefix;
  - a file moved to another folder keeps its prefix for new sections;
  - a new file is created with a chosen prefix.
- *Done when* `bun test` passes.

<a id=""></a>
### Phase 4 - Settings API and Dialogs

- §4.5 to §4.7.
- API tests:
  - read and write a folder's type and prefix, keeping comments and other keys;
  - `inherit` for both deletes the file;
  - a stale version answers conflict;
  - a symbolic link out of the root is refused;
  - creating a folder with non-inherited values writes its file, and with inherited ones writes none.
- Component tests:
  - the folder dialog's type and prefix fields, the inherited labels, the status messages and the conflict;
  - the create dialog's prefix field for a file in a sectioned folder only, and the type fields for a folder.
- End-to-end (`e2e/settings.spec.ts`, rewritten):
  - make a folder Change with its own prefix and check the file written;
  - set a subfolder to Non-sectioned;
  - set it back to Inherited and see its file removed;
  - create a file with another prefix and check its root anchor;
  - type `<a id="XYZ-?">` over a heading's ID in the text editor, save, and see the new ID with the UID kept.
- *Done when* the component and end-to-end tests pass on Chrome and WebKit.

<a id=""></a>
### Phase 5 - Migration and Documentation

- **This repository:**
  - write the four folder files (R8.1);
  - delete `.specquer/shared/section-prefixes.config.yaml`;
  - check, with a script run before and after, that the same files are sectioned with the same prefixes (R8.3).
- **Leftover mentions (R8.5):**
  - code comments and tests: `section-prefixes.config.yaml` and `documents.yaml`, including `data.ts`'s "an old `documents.yaml` is ignored" and the tests that it isn't written;
  - specifications: Data Architecture, Server Requirements, Client Requirements, Security, Information Architecture, as in requirements §4.
- **Agent rules:** `shared/src/sections/agent-guide.ts` describes `XYZ-?`. `AGENTS.md` here is rewritten with **Add section anchors** and the box ticked, or by hand to the same text.
- **`CLAUDE.md`:** the `sections/` and `settings/` descriptions, the "Section anchors" rules, and Step 008 in "Project state".
- The docs sidebar gains Step 008, and an Implementation Status section is added here.
- *Done when* `bun run typecheck`, `bun test`, `bun run test:e2e` and `docs:build` pass, and `grep` finds neither old file name outside `documentation/work-items/`.

<a id=""></a>
## 6. Decision Points

_Proposed_; the work proceeds on them unless they are changed.

- **D1. The tree listing finds the files.** Every operation that issues IDs scans first, and the scan lists the files anyway. Adding the configuration files to the same Git query or walk costs nothing extra. A file added by hand between scans counts from the next scan, which is the next save or tree load.
- **D2. `prefixFor` and `isSectioned` keep their signatures.** The index's many callers stay as they are; only the reader behind them changes. Prefixes by section are worked out in `anchor()` and `create()`, the only places IDs are issued.
- **D3. A prefix change is a renumbering with a reason of its own.** It reuses the renumber path, the notice and the data rebuild, and differs only in keeping the UID. The old ID is gone from `sections.yaml` as with any renumbering, and `lastSequence` keeps it from being reused.
- **D4. Custom anchors share the paragraph.** Requirements D1: the section anchor goes first in the custom anchor's paragraph. The recognizer accepts a paragraph of anchors whose first is a section anchor, so files written this way read back unchanged.
- **D5. Route names stay.** `GET`/`PUT /api/settings/folder` and `POST /api/create` keep their paths; only their bodies change. The client and server change in the same commit, so nothing else depends on the old shapes.
- **D6. One shared fields component.** The folder settings and new folder dialogs show the same type and prefix choices with the same validation.

<a id=""></a>
## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Changing what counts as a placeholder shifts which sections the recognizer finds | Wrong anchors added or IDs lost in existing files | The recognition tests keep their outcomes, and the Phase 5 script checks every file in this repository before and after |
| `XYZ-?` in the WYSIWYG editor | Milkdown or the paste hook could mangle or miss it | An end-to-end check in Phase 4 types it in the text editor; the paste tests cover the WYSIWYG editor |
| Prefix by section changes `anchor()`, the hub of allocation | Regressions in renumbering and copies | Phase 3 runs the full reconciliation and API suites unchanged besides the fixtures |
| Many folder files | Slower scans | One stat per known file per load, and reading only changed files |
| Writes outside `.specquer/` | A new write path for security | §4.7's confinement, with a symbolic-link test |
| Rewriting the fixtures | Large test diffs | One fixture helper, in place of each test's config text |
