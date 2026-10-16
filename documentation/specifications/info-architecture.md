<a id="SPEC-00032" data-uid="iy4rl3v8on0h"></a>

<a id="SPEC-00033" data-uid="d22x9flrhjgs"></a>
# Specquer Information Architecture

This document describes what Specquer works with and how its screen is organized. The detailed behavior is in [Client Requirements](client-requirements.md) and [Server Requirements](server-requirements.md).

<a id="SPEC-00034" data-uid="ksr9zuovd7zl"></a>
## 1. Content

| Concept | Description |
| ------- | ----------- |
| Root folder | The folder Specquer was launched in (or given on the command line), or the folder above it that holds `.specquer/` (within the same Git repository). Everything Specquer shows lies inside it. Specquer doesn't run inside a nested Specquer folder, and reports a `.specquer/` below the root as a section problem. Usually a Git repository or part of one. |
| Workspace path | A path relative to the root, with `/` as the separator, such as `docs/specs/login.md`. The root itself is the empty path. All paths in the API and in the UI state are workspace paths. |
| Folder | In the **Specs** view, a folder under the root that contains Markdown files, directly or further down, or that is empty; in **All Files**, any folder under the root. `.git`, `node_modules`, `.specquer` (but for its `shared/` folder, in All Files) and anything Git ignores are never shown. |
| Other file | Any file that isn't Markdown, shown in the **All Files** view and opened view-only: text as a highlighted code block with line numbers, images fitted to the pane, anything else as a placeholder ([Step 014](/work-items/step-014-all-files/requirements)). Specquer never changes one. |
| Spec file | A Markdown (`.md`) file: optional YAML front matter followed by a GitHub Flavored Markdown body. Raw HTML may appear, for example traceability anchors. MDX is not supported. |
| Front matter | The YAML between the `---` lines at the top of a file. Free-form; there is no schema. |
| Body | The Markdown after the front matter, structured by nested headings (`#`, `##`, `###` and so on). |
| UI state | Per-user settings in `.specquer/user/uistate.yaml`: theme, pane width, expanded folders, recent files, the open file and per-file view settings. See [Data Architecture](data-architecture.md) §3. |
| Section | A whole spec file (the root section), a top-level heading with its content, or an item of a sectioned list. Sectioned files are chosen by the folders' types, in each folder's `.specquer-config.yaml`. See [Data Architecture](data-architecture.md) §2. |
| Section anchor and ID | An invisible HTML anchor that marks a section with a permanent ID such as `REQ-00257`, used in links to the section, and its UID (`data-uid`), the section's identity. The root anchor's UID is the document ID. |
| Folder configuration | A folder's `.specquer-config.yaml`: its type (Baseline, Change, Auxiliary or Non-sectioned) and default prefix, each inherited by the folders in it unless they set their own. Edited in the folder settings dialog; shown, view-only, in **All Files**. |
| Shared data | The section data files in `.specquer/shared/`, committed to Git: per prefix, `sections.yaml` (live and retired sections, the root sections keyed by the document ID), written by Specquer, and optionally `prefix.config.yaml` (the prefix's allowed statuses), edited by hand. |
| Agent guide | Optional section anchor rules for coding agents in the root folder's `AGENTS.md`, added on request by **Add section anchors** (in a folder's settings). |
| Summary | An AI-generated summary of a heading section, or of the whole document, shown in the preview in place of the section's content by the summary slider. Made from the saved file by the model named in the agent configuration, and cached until unused for 60 days. See [Data Architecture](data-architecture.md) §4. |
| Agent configuration | `.specquer/shared/agent.config.yaml` (committed) names the model for agent features and the environment variable holding its key; an optional `.specquer/user/agent.config.yaml` overrides it for one user. Without it, Specquer makes no network calls. |
| Summary cache | `.specquer/cache/summaries.db`, per user and ignored by Git. |
| Chat | Questions about the specs answered by the model, in the chat pane, grounded in every Markdown file the tree shows and citing the sections used ([Step 010](/work-items/step-010-document-chat/requirements)). |
| Chat history | `.specquer/user/chat-history.yaml`: the conversation, per user, ignored by Git, at most 200 questions with their answers. |
| Search index | `.specquer/cache/search.db`: the full-text index (SQLite FTS5) the chat searches; per user, ignored by Git, rebuilt from the files. |
| Comment thread | A conversation of Markdown comments about one section, Open or Resolved, kept in the document's sidecar `<name>.md.comments.yaml` (committed; shown, view-only, in **All Files**) and read and written in the Comments pane ([Step 012](/work-items/step-012-comment-threads/requirements)). |

```
root folder
├── .specquer/shared/        agent configuration and section data, committed
│   ├── agent.config.yaml    optional: the model for summaries
│   └── REQ/
│       ├── sections.yaml    written by Specquer
│       └── prefix.config.yaml  optional, by hand: the allowed statuses
├── .specquer/user/          per-user state, ignored by Git
│   ├── .gitignore           *
│   ├── agent.config.yaml    optional: a personal model
│   ├── chat-history.yaml    the chat's conversation
│   ├── instance.lock        held by the running Specquer
│   ├── instance.json        the running Specquer's URL
│   └── uistate.yaml
├── .specquer/cache/         per-user cache, ignored by Git
│   ├── .gitignore           *
│   ├── search.db            the chat's full-text index
│   └── summaries.db
├── docs/                    folder (shown: contains .md files)
│   ├── .specquer-config.yaml  optional: the folder's type and default prefix
│   ├── overview.md          spec file
│   ├── overview.md.comments.yaml  optional: its comment threads (not shown)
│   └── images/              not shown (no .md files)
├── AGENTS.md                optional: rules for coding agents
└── README.md                spec file
```

<a id="SPEC-00035" data-uid="ih7efd3xle7k"></a>
## 2. Screen Layout

Specquer has one view: a header and two or three panes side by side. The third pane on the right shows the chat or the comment threads, opened and closed with the **Chat** and **Comments** buttons in the header.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ [icon] Specquer                                       [chat] [theme] [gear]   │ header (navigation color)
├────────────┬──────────────────────────────────┬───────────────────────────────┤
│ ▾ docs     │ docs › login.md ▾  Saved [Text…] │ Chat                   Clear  │ file path, status, view type
│   ▸ specs  ├──────────────────────────────────┤        How do logins lock?    │
│ README.md  │ title: Login                     │ ┌ ✦ AI response · gemma ────┐ │ front matter (YAML)
│            ├══════════════════════════════════┤ │ After five failures [1].  │ │ drag bar
│            │ # Login                          │ └───────────────────────────┘ │
│            │                                  │                               │ Markdown content
│            │ ## Requirements                  │ ┌───────────────────────────┐ │ (text, split, preview
│            │ ...                              │ │ Ask about the specs       │ │  or WYSIWYG)
└────────────┴──────────────────────────────────┴───────────────────────────────┘
       ▲ drag bars between the panes; the chat pane on the right is optional
```

| Region | Contents |
| ------ | -------- |
| Header | App icon and application name; the chat toggle, the light/dark switch and the settings gear button |
| Left pane | The **Specs** / **All Files** selector above the folder tree; context menu on each folder (New file, New folder, Settings, Section problems, Rename, Delete), each Markdown file (Rename, Delete) and the empty space below the last entry (New file, New folder, Settings, Section problems for the root); none on other files or in `.specquer` |
| Right pane, row 1 | File path breadcrumb (a drop-down of recent files once there are any), save status, view-type switch |
| Right pane, row 2 | Front matter editor with a drag bar below it |
| Right pane, row 3 | Markdown content in one of four views |
| Chat pane (optional) | **Clear**, the conversation (questions on the right, AI answers on the left with their citations), and the question input with **Send** or **Stop** |
| Dialogs | New file, new folder, rename, delete, folder settings, add section anchors, section problems, settings (model, summarization and chat), and the conflict dialog when a file changed on disk |

<a id="SPEC-00036" data-uid="x9pynsmcyb9v"></a>
## 3. Navigation

- **Opening a file:** single-click it in the tree, pick it from the recent-files drop-down, or click a link to it in the preview; a link to a section scrolls the preview to it. Only one file is open at a time; there are no tabs. A file other than Markdown opens view-only.
- **Recent files:** the last ten files opened, most recent first, not counting the open one. They persist across restarts.
- **Restart:** Specquer reopens the file that was open last, with its view type, and restores expanded folders, pane width and theme.
- **Browser back and forward** don't navigate between files.

<a id="SPEC-00037" data-uid="a1ji7t4zjjgj"></a>
## 4. View Types

| View | Content area | Editable |
| ---- | ------------ | -------- |
| Text (default) | CodeMirror with Markdown highlighting | Yes |
| Split | CodeMirror on the left, preview on the right | Text side |
| Preview | Rendered, sanitized HTML, with badges for section anchors, and the summary slider | No |
| WYSIWYG | Milkdown rich-text editor | Yes |

The view type is remembered per file. All views edit the same in-memory copy of the file, so switching views never loses changes.

In the split and preview views, the summary slider above the preview replaces sections, level by level, with AI summaries, down to one summary of the whole document. Its position is remembered per file. See [Client Requirements](client-requirements.md) §6.2.

<a id="SPEC-00038" data-uid="hxls9q5i5br9"></a>
## 5. Saving

Edits are kept in memory and saved automatically: before another file opens, when the browser tab loses focus or the page closes, and every 60 seconds while there are changes. The save status shows "Saved", "Unsaved changes", "Saving…", or an error; "Unsaved changes" is a button that saves now. Files that weren't edited are never written.
