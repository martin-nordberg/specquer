<a id="WORK-00225" data-uid="k3np6ol3g681"></a>

<a id="WORK-00226" data-uid="gl0jkpgx2wij"></a>
# Step 008 - Folder Types and Prefixes

_Requirements for replacing `section-prefixes.config.yaml` with per-folder settings, folder types and prefixes chosen in section anchors. Drafted October 2026._

<a id="WORK-00227" data-uid="dzc1zf4nrzf0"></a>
## 1. Summary

`.specquer/shared/section-prefixes.config.yaml` is clumsy, and it is far from the folders it configures. A file that needs its own prefix still needs a hand-edited key in it.

Step 008 makes three changes:

| Today | Step 008 |
| --- | --- |
| One configuration file maps folder and file paths to a prefix, or to `null` for not sectioned | A `.specquer-config.yaml` in each folder that needs one, holding the folder's type and default prefix (R1, R2) |
| A folder is sectioned or not | A folder is Baseline, Change, Auxiliary or Non-sectioned (R2) |
| A file's prefix comes from the configuration by path, and every new section in the file takes it | A new section takes its parent section's prefix, and the root section takes the folder's. Typing `<a id="XYZ-?"></a>` picks prefix `XYZ` for a section, new or existing (R3, R4) |

The folder settings dialog and the new folder and new file dialogs follow (R6). Specquer's own documentation is migrated in the step's commit (R8).

<a id="WORK-00361" data-uid="sjo1fwvrgbp0"></a>
## 2. Precedence

Step 008 takes precedence over the specifications and earlier steps where they conflict:

| Topic | Before | Step 008 (wins) |
|---|---|---|
| Configuration | `.specquer/shared/section-prefixes.config.yaml`, longest matching path wins | `.specquer-config.yaml` per folder, each key inherited from the nearest folder that sets it (R1) |
| Sectioned or not | A prefix, or `null` | `folderType`; `NONSECTIONED` is not sectioned (R2) |
| Single files | A file key gives a file its own prefix, or sections it, or switches it off | No file keys. The root anchor gives the prefix, and a file is sectioned exactly when its folder is (R5) |
| A new section's prefix | The file's configured prefix | Its parent section's prefix (R4) |
| Placeholders | Any `id` in a section anchor's place that isn't a section ID | Only `""` and `XYZ-?`; any other `id` is left alone (R3) |
| Changing a section's prefix | Not possible; an edited ID is restored | `<a id="XYZ-?" data-uid="…"></a>` gives the section a new ID and keeps its UID (R3) |
| Renumbering (duplicates, copies, unknown prefixes) | Into the file's prefix | Into the section's own prefix, or the parent's for an unknown one (R4) |
| Folder settings dialog | Inherited / Yes with a prefix / No | Inherited / Baseline / Change / Auxiliary / Non-sectioned, and a prefix (R6) |

<a id="WORK-00228" data-uid="rtf35suyz877"></a>
## 3. Requirements

<a id="WORK-00229" data-uid="cevn1z4gupnq"></a>
### R1. The Folder Configuration File

1. A folder's settings are in a file named `.specquer-config.yaml` in the folder itself. The root folder's file sits in the root, next to `.specquer/`.
2. The file is plain YAML with two optional top-level keys, and no wrapper:

   ```yaml
   defaultPrefix: XYZ
   folderType: BASELINE  # or CHANGE, AUXILIARY, NONSECTIONED
   ```

3. Each key is inherited separately: a folder's value is the one in the nearest `.specquer-config.yaml` at or above it that sets the key, so a subfolder can change only its prefix. A folder with no `folderType` at or above it is not sectioned, as a root without configuration is today.
4. A file sets a key only where it differs from the inherited value. This is a rule for the dialogs that write it (R6); a hand-written file may repeat a value.
5. Writing a file changes only the keys concerned, with the `yaml` document API, so other keys, comments and key order survive, as in Step 006. A file left with no keys is deleted.
6. An unreadable or invalid file, or an invalid value in it, gives a warning and is ignored, so its folder inherits. It never stops the server, as with the other configuration files.

<a id="WORK-00240" data-uid="bvji4wgiv8x6"></a>
### R2. Folder Types

1. A folder has one of four types:

   | Type | `folderType` | Contents |
   | --- | --- | --- |
   | Baseline Specs | `BASELINE` | The current or intended state of the whole system |
   | Change Specs | `CHANGE` | The work for a given task or feature |
   | Auxiliary Specs | `AUXILIARY` | Sectioned specs that aren't updated from change specs |
   | Non-sectioned Documents | `NONSECTIONED` | Markdown that Specquer doesn't section |

2. In this step the three sectioned types behave alike, as a sectioned folder does today. The type is recorded for later steps, and nothing branches on it yet.
3. A sectioned folder needs a `defaultPrefix` at or above it. Without one, it gets a warning and is treated as not sectioned. A `defaultPrefix` in a `NONSECTIONED` folder is ignored.

<a id="WORK-00241" data-uid="a3idt71l9ljf"></a>
### R3. Section Anchors Typed by Hand

1. In a section anchor's place, three kinds of anchor are recognized:

   | Anchor | Meaning |
   | --- | --- |
   | `<a id="SPEC-00012" data-uid="…"></a>` | A section anchor, as today |
   | `<a id=""></a>` | A placeholder: a new ID in the inherited prefix (R4) |
   | `<a id="XYZ-?"></a>` | A placeholder: a new ID in prefix `XYZ`, which must be a valid prefix (`^[A-Z][A-Z0-9]{1,4}-\?$`) |

2. Any other `id` (`intro`, `xyz-?`, `TODO`) is no longer a placeholder. It is an ordinary anchor and is left as it is. Before Step 008, typing anything for the `id` got an ID; this narrower rule means a typo can't silently start a prefix.
3. **Changing a section's prefix.** Replacing only the `id` of an existing anchor with `XYZ-?`, keeping its `data-uid`, gives the section a new ID in `XYZ` and keeps its UID, so it stays the same section. The old ID is never reused (`lastSequence`), and links to it break, as with any renumbering. Its subsections keep their IDs; only new ones inherit the new prefix (R4).
4. An `XYZ-?` placeholder without a `data-uid` is a new section with a new UID.
5. An edited ID in the section ID format (`SPEC-00099` typed over `SPEC-00012`) is still restored from its UID, as today; `XYZ-?` is the one way to ask for a change.
6. A custom anchor in a section anchor's place leaves that place free. The section gets its own anchor (see D1).
7. The agent rules (`shared/src/sections/agent-guide.ts`, written to `AGENTS.md`) and `CLAUDE.md`'s "Section anchors" rules describe `<a id="XYZ-?"></a>`: for a new section with another prefix, or to change a section's prefix while keeping its `data-uid`.

<a id="WORK-00231" data-uid="oxs15noiu2ty"></a>
### R4. Choosing the Prefix

1. A new ID's prefix is the placeholder's (`XYZ-?`), or else the parent section's prefix.
2. The parent section:
   - of a heading, the nearest heading above it at a higher level, or the root section if there is none;
   - of a list item, the section of the heading that holds the list, or the root section;
   - of the root section, none. Its prefix is the placeholder's, or else the folder's `defaultPrefix`.
3. A file's default prefix is thus its root anchor's prefix. A file moved to another folder keeps its own prefix for new sections, where today it takes the new folder's.
4. Prefixes are worked out top-down within one save, so a new heading under a new `XYZ-?` heading gets `XYZ` too.
5. Renumbering keeps the section's own prefix: a duplicate, **Renumber this copy** and **Add section anchors** give a new number in the prefix the section had. Today they use the file's prefix.
6. An ID whose prefix isn't known (typed or pasted from elsewhere, with no `sections.yaml`) is renumbered into the parent's prefix, as it is into the file's today. A known prefix is one with a `sections.yaml`, or a folder's `defaultPrefix`.

<a id="WORK-00242" data-uid="lezsdvvfgb42"></a>
### R5. Single Files

1. There are no per-file settings. A file's prefix comes from its root anchor (R4).
2. A file is sectioned exactly when its folder is, whatever anchors it holds. Sectioning one file in a non-sectioned folder (`README.md: TOP` today), and switching one file off in a sectioned folder (`null`), are dropped.

<a id="WORK-00236" data-uid="c5fzjupslwpq"></a>
### R6. Dialogs

1. **Folder settings:**
   - **Type:** Inherited, Baseline, Change, Auxiliary or Non-sectioned. **Inherited** shows where the value comes from and what it is, as in Step 006.
   - **Prefix:** shown for a sectioned type, filled with the inherited prefix, validated and upper-cased as in Step 006.
   - **Saving:** writes only the values that differ from the inherited ones (R1). Step 006's list of "Files with their own settings" goes. **Add section anchors…** is still offered when a folder becomes sectioned.
2. **New folder:** the dialog also asks for the type and, for a sectioned type, the prefix, both defaulting to the inherited values. A `.specquer-config.yaml` is written only when they differ, so most new folders get none.
3. **New file:** in a sectioned folder, the dialog also asks for the prefix, defaulting to the folder's `defaultPrefix`. The new file's root anchor gets an ID in that prefix.
4. Saves carry the version of the folder's own `.specquer-config.yaml`, a missing file included. A file changed on disk answers 409, as in Step 006, and two folders never conflict.

<a id="WORK-00235" data-uid="nv5gzm1tv0gl"></a>
### R7. Storage and Security

1. **Finding the files:**
   - Specquer looks for `.specquer-config.yaml` only in the folders the tree walk visits, with the same Git-ignore rules, never `.git` or `node_modules`.
   - Each file is read again when its modification time changes. The prefix lookup is cached by folder.
2. **The tree:** the folder tree lists only Markdown files, so these files stay out of it; the folder settings dialog is their UI.
3. **Section data:** it stays in `.specquer/shared/<prefix>/sections.yaml`, unchanged.
4. **Security §5:** the server writes and deletes `.specquer-config.yaml` in folders inside the root. It's the first non-Markdown file written outside `.specquer/`. Writes are confined as other writes are:
   - only into an existing folder whose real path is inside the root;
   - only under the fixed file name;
   - no symbolic links followed out of the root.

<a id="WORK-00237" data-uid="bx05k8h34coo"></a>
### R8. Migration

1. **This repository:** it gets four folder files, written in the step's commit:

   | Folder | `defaultPrefix` | `folderType` |
   | --- | --- | --- |
   | `documentation/specifications/` | `SPEC` | `BASELINE` |
   | `documentation/work-items/` | `WORK` | `CHANGE` |
   | `documentation/notes/` | `NOTE` | `AUXILIARY` |
   | `documentation/references/` | `REF` | `AUXILIARY` |

2. **File keys:** the two go with nothing in their place. `ideas.md` and `glossary.md` already start with root anchors `IDEA-00001` and `DEFN-00001`.
3. **Prefixes stay the same.** No file here mixes prefixes outside code examples, so R4 assigns the same prefixes as today. A test checks that the same files are sectioned with the same prefixes before and after.
4. **The old file:** `section-prefixes.config.yaml` is deleted in the same commit. There's no migration code, no fallback and no warning for an old file elsewhere; no other repository needs one yet.
5. **Leftover mentions:** the code and the baseline specifications drop every mention of `section-prefixes.config.yaml`, and the leftover mentions of `documents.yaml` too (`server/src/sections/data.ts`, its tests and the specifications). Only the earlier steps' work items keep them.
6. **Unchanged:** sections, IDs, UIDs and `sections.yaml`.

<a id="WORK-00362" data-uid="ai2qk6ralt5p"></a>
### R9. Unchanged

- Section IDs and UIDs, `sections.yaml` and the reconciliation rules other than those in R3 and R4.
- Copy detection (Step 007), **Section problems**, paste handling and conflict markers.

<a id="WORK-00238" data-uid="vakpb8gj6mfk"></a>
## 4. Specifications to Update

- **[Data Architecture](/specifications/data-architecture):**
  - §2.1: placeholder, known prefix and folder type;
  - §2.2: the recognized anchors (R3);
  - §2.3: rewritten for R1 and R2;
  - §2.5: unknown prefixes and the prefix renumbering uses;
  - §2.6: choosing the prefix by section (R4).
- **[Server Requirements](/specifications/server-requirements):** the folder settings API and the files the server writes.
- **[Client Requirements](/specifications/client-requirements):** the folder settings, new folder and new file dialogs.
- **[Security](/specifications/security):** §5, writing and deleting `.specquer-config.yaml`.
- **[Information Architecture](/specifications/info-architecture):** the configuration files and the folder diagram.
- **Step 006's code:**
  - the folder settings dialog;
  - `GET` and `PUT /api/settings/folder`;
  - `folderSettingSchema` in `shared/settings`;
  - `e2e/settings.spec.ts` and the settings tests.
- **`CLAUDE.md`:** the prefix configuration in the `sections/` and `settings/` descriptions, and the "Section anchors" rules.

<a id="WORK-00239" data-uid="srszemq4sqll"></a>
## 5. Decision Points

Decided while reviewing the requirements:

- **No `specquer:` wrapper** in `.specquer-config.yaml`, and `NONSECTIONED` for non-sectioned folders.
- **A prefix changed by hand keeps the section's UID** (R3.3).
- **Only `""` and `XYZ-?` are placeholders** (R3). This narrower rule replaces a notice for new prefixes as the guard against typos.
- **Single-file sectioning and switching off are dropped** (R5).
- **An empty `.specquer-config.yaml` is deleted** (R1.5).
- **Notes and references are Auxiliary** (R8).
- **No warning or fallback for the old file** (R8.4).

_Proposed_; the work proceeds on them unless they are changed:

- **D1. A custom anchor before a heading.** In a sectioned file, `<a id="intro"></a>` directly before a heading is no longer that heading's section anchor. Specquer then puts the section anchor at the start of the same paragraph (`<a id="SPEC-00031" data-uid="…"></a><a id="intro"></a>`). A paragraph made only of anchors and starting with a section anchor counts as that heading's anchor. The alternative, a new paragraph above, would separate the section anchor from its heading.
- **D2. Unknown prefixes go to the parent's prefix** (R4.6), not their own. With `XYZ-?` as the way to start a prefix, an ID with an unknown prefix most likely came from another repository.
- **D3. `xyz-?` is not upper-cased.** The format is exact, like a section ID, and anything else is left as written. A lower-case request is visibly not converted, which is easy to spot and fix.

<a id="WORK-00363" data-uid="t2slxlx5kyr4"></a>
## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A custom anchor before a heading changes meaning (R3.2) | Files that relied on `<a id="intro"></a>` becoming a section anchor get an extra anchor | Such anchors already became section IDs before Step 008, so existing files are unaffected; D1 keeps the custom anchor working |
| Many `.specquer-config.yaml` files to find | Slower tree loads and scans | Only folders the tree walk visits, cached by modification time |
| A prefix changed by hand breaks links to the old ID | Dangling links | Same as renumbering a duplicate; the request is explicit (`XYZ-?`) |
| Step 006's folder dialog and API change shape | Test rework | Planned in the implementation plan's phases |
