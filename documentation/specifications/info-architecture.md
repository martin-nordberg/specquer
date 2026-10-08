# Specquer Information Architecture

This document describes what Specquer works with and how its screen is organized. The detailed behavior is in [Client Requirements](client-requirements.md) and [Server Requirements](server-requirements.md).

## 1. Content

| Concept | Description |
| ------- | ----------- |
| Root folder | The folder Specquer was launched in (or given on the command line). Everything Specquer shows lies inside it. Usually a Git repository or part of one. |
| Workspace path | A path relative to the root, with `/` as the separator, such as `docs/specs/login.md`. The root itself is the empty path. All paths in the API and in the UI state are workspace paths. |
| Folder | A folder under the root that contains Markdown files, directly or further down, or that is empty. Other folders without Markdown files, `.git`, `.specquer`, `node_modules` and anything Git ignores are not shown. |
| Spec file | A Markdown (`.md`) file: optional YAML front matter followed by a GitHub Flavored Markdown body. Raw HTML may appear, for example traceability anchors. MDX is not supported. |
| Front matter | The YAML between the `---` lines at the top of a file. Free-form; there is no schema. |
| Body | The Markdown after the front matter, structured by nested headings (`#`, `##`, `###` and so on). |
| UI state | Per-user settings in `.specquer/user/uistate.yaml`: theme, pane width, expanded folders, recent files, the open file and per-file view settings. See [Data Architecture](data-architecture.md) §3. |
| Section | A whole spec file (the root section), a top-level heading with its content, or an item of a sectioned list. Sectioned files are chosen by `.specquer/shared/section-prefixes.config.yaml`. See [Data Architecture](data-architecture.md) §2. |
| Section anchor and ID | An invisible HTML anchor that marks a section with a permanent ID such as `REQ-00257`, used in links to the section. The root anchor also carries the document ID. |
| Shared data | The section configuration and data files in `.specquer/shared/`, committed to Git: `documents.yaml` and, per prefix, `sections.yaml`. |

```
root folder
├── .specquer/shared/        section configuration and data, committed
│   ├── section-prefixes.config.yaml
│   ├── documents.yaml
│   └── REQ/sections.yaml
├── .specquer/user/          per-user state, ignored by Git
│   ├── .gitignore           *
│   └── uistate.yaml
├── docs/                    folder (shown: contains .md files)
│   ├── overview.md          spec file
│   └── images/              not shown (no .md files)
└── README.md                spec file
```

## 2. Screen Layout

Specquer has one view: a header and two panes side by side.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [icon] Specquer                                             [theme]  │ header (navigation color)
├──────────────┬───────────────────────────────────────────────────────┤
│ ▾ docs       │ docs › specs › login.md ▾     Saved  [Text|Split|…]   │ file path, status, view type
│   ▸ specs    ├───────────────────────────────────────────────────────┤
│   overview.md│ title: Login                                          │ front matter (YAML)
│ README.md    ├═══════════════════════════════════════════════════════┤ drag bar
│              │ # Login                                               │
│              │                                                       │ Markdown content
│              │ ## Requirements                                       │ (text, split, preview
│              │ ...                                                   │  or WYSIWYG)
└──────────────┴───────────────────────────────────────────────────────┘
       ▲ drag bar between the panes
```

| Region | Contents |
| ------ | -------- |
| Header | App icon and application name; light/dark switch |
| Left pane | Folder tree; context menu on each folder (New file, New folder, Add section anchors, Rename, Delete), each file (Rename, Delete) and the empty space below the last entry (New file, New folder, Add section anchors in the root) |
| Right pane, row 1 | File path breadcrumb (a drop-down of recent files once there are any), save status, view-type switch |
| Right pane, row 2 | Front matter editor with a drag bar below it |
| Right pane, row 3 | Markdown content in one of four views |
| Dialogs | New file, new folder, rename, delete, add section anchors, and the conflict dialog when a file changed on disk |

## 3. Navigation

- **Opening a file:** single-click it in the tree, pick it from the recent-files drop-down, or click a link to it in the preview; a link to a section scrolls the preview to it. Only one file is open at a time; there are no tabs.
- **Recent files:** the last ten files opened, most recent first, not counting the open one. They persist across restarts.
- **Restart:** Specquer reopens the file that was open last, with its view type, and restores expanded folders, pane width and theme.
- **Browser back and forward** don't navigate between files.

## 4. View Types

| View | Content area | Editable |
| ---- | ------------ | -------- |
| Text (default) | CodeMirror with Markdown highlighting | Yes |
| Split | CodeMirror on the left, preview on the right | Text side |
| Preview | Rendered, sanitized HTML, with badges for section anchors | No |
| WYSIWYG | Milkdown rich-text editor | Yes |

The view type is remembered per file. All views edit the same in-memory copy of the file, so switching views never loses changes.

## 5. Saving

Edits are kept in memory and saved automatically: before another file opens, when the browser tab loses focus or the page closes, and every 60 seconds while there are changes. The save status shows "Saved", "Unsaved changes", "Saving…", or an error. Files that weren't edited are never written.
