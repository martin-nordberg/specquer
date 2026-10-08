# Specquer Client Requirements

Requirements for the browser user interface (`client/`). They come from [Step 001](/work-items/step-001-doc-editing/requirements), its [implementation plan](/work-items/step-001-doc-editing/implementation-plan), [New File and Folder](/work-items/step-001-doc-editing/new-file-folder) and [Step 002](/work-items/step-002-sections/requirements) (sections). The screen layout is in [Information Architecture](info-architecture.md).

## 1. General

1. The UI talks only to its own server over HTTP, through the typed API client. It uses no browser-only APIs it can't do without, so a desktop shell (Tauri, Electrobun) can host it later.
2. Paths and names are validated with the same functions the server uses (`@specquer/shared/paths`).
3. Technologies: React, Tailwind CSS, shadcn components, CodeMirror, Milkdown, the shared unified/remark/rehype pipeline with `hast-util-to-jsx-runtime`, Hono's client, Zod and `yaml`.

## 2. Layout

1. The window is split into a folder pane on the left and a file pane on the right, with a drag bar between them.
2. Dragging the bar (or pressing the arrow keys on it) changes the folder pane's width, as a fraction of the window between 10% and 70%. The fraction persists in the UI state.

## 3. Folder Tree

1. The tree starts at the root folder and shows folders and `.md` files only, as listed by the server (see [Server Requirements](server-requirements.md) §3). Empty folders are shown too, so a new folder appears at once.
2. Folders come before files; names sort naturally, ignoring case.
3. Clicking a folder expands or collapses it. Expanded folders persist in the UI state.
4. Single-clicking a file opens it in the file pane. The open file is highlighted with the navigation color.
5. Right-clicking a folder or file opens a context menu with **Rename…** and **Delete…**. For a folder, the menu starts with **New file…**, **New folder…** and **Add section anchors…**. Right-clicking the empty space below the last entry (or in an empty tree) offers the same three for the root folder.

### 3.1 Rename

1. A modal dialog has a text box with the current name, a **Rename** button and a **Cancel** button.
2. For a file, the text box holds the name without its extension; the extension (`.md`) is shown after the text box and can't be changed.
3. Rename never moves an entry to another folder.
4. An invalid name (empty, leading or trailing spaces, `/` or `\`, `.` or `..`, control characters, `.git`, `.specquer`, too long) keeps the dialog open with the reason, in the error color.
5. A name already used by a file or folder in the same folder keeps the dialog open with "A file or folder with that name already exists."
6. Unsaved changes to the open file are saved first if the rename affects it. After the rename, the open file follows its new path and the UI state is updated (see [Data Architecture](data-architecture.md) §3.4).

### 3.2 New File and New Folder

1. A modal dialog has an empty text box, a **Create** button and a **Cancel** button. It is titled **New file** or **New folder** and names the folder the entry is created in ("the root folder" for the root).
2. For a file, the extension (`.md`) is shown after the text box and added to the name; a folder's name has no extension.
3. Invalid names and names already used in the folder keep the dialog open with the reason, as for rename (§3.1, items 4 and 5).
4. After creating the entry, the folder it was created in (unless it is the root) is expanded and the tree is reloaded, so the new entry shows.
5. A new file is created empty, or with its root section anchor if it is sectioned, and opened in the file pane (saving the previously open file first, as for any file switch).

### 3.3 Delete

1. A modal dialog has a **Delete** button (error color) and a **Cancel** button.
2. For a folder, the dialog lists every file that will be deleted, including files the tree doesn't show, and how many of them the tree doesn't show.
3. The dialog names the files that aren't committed to Git and can't be recovered. If the root isn't in a Git repository, it says so.
4. Deleting the open file, or a folder containing it, closes it. The UI state drops every entry for deleted paths.

### 3.4 Add Section Anchors

1. The open file is saved first.
2. A modal dialog says how many sectioned files in the folder will change and lists them, with **Add anchors** and **Cancel** buttons; when none would change it says so and offers only **Close**.
3. Adding the anchors rewrites those files (see [Server Requirements](server-requirements.md) §6). If the open file was among them, it is reloaded.

## 4. File Path

1. The open file's path is shown from the root folder as a shadcn breadcrumb.
2. When the path doesn't fit, leading folders are replaced by one "…" (its tooltip shows the hidden folders). The file name is never hidden.
3. Once there are recent files, the file name becomes a drop-down listing up to ten of them (most recent first, not counting the open file). Choosing one opens it.

## 5. Front Matter

1. The front matter is edited in its own CodeMirror editor with YAML highlighting, between the file path and the content. The `---` delimiters are not shown.
2. The editor starts one line high for a file without front matter and three lines high otherwise.
3. A drag bar below the editor changes its height; the height is remembered per file in the UI state.
4. Typing into the editor of a file without front matter adds a front matter block; clearing the editor removes the block.
5. There is no schema. Invalid YAML is kept and saved as typed; the editor shows an "Invalid YAML" marker in the warning color, with the parser's messages as a tooltip.

## 6. Markdown Content

1. The content can be shown in four view types: **Text** (CodeMirror, Markdown mode), **Split** (CodeMirror and preview side by side), **Preview** (read-only) and **WYSIWYG** (Milkdown).
2. The view type is persisted per file; files open in Text the first time.
3. One in-memory copy of the file is shared by all views; switching views keeps unsaved changes.
4. The preview is produced by the shared pipeline in a Web Worker and rendered with `hast-util-to-jsx-runtime`. In the split view it updates about 250 ms after typing stops; results for outdated text are dropped.
5. In the preview, links to other `.md` files in the workspace open them in Specquer, in-page links scroll, and other links open in a new tab. A link to a section of another document (`other.md#REQ-00012`) opens it and, in the preview, scrolls to the section.
6. Raw HTML in the preview is sanitized (see [Security](security.md) §6).
7. Opening a file in WYSIWYG without editing it never changes the file; Milkdown's output is used only after the user changes something (Milkdown rewrites some Markdown, such as list markers, tables and reference links).

### 6.1 Sections

1. In the preview and split views, a badge stands for each section anchor: at the start of a heading, between a list item's marker and its content, and at the top for the root section. The anchor itself stays invisible. The badge is the favicon (§9).
2. Hovering or focusing a badge shows a tooltip with the section ID, the document path and the section's CUID2. Badges can be reached with the keyboard. Clicking one copies the section ID to the clipboard and confirms it in the tooltip.
3. The WYSIWYG view shows anchors as badges too (a heading's badge on the line above it) and saves them unchanged.
4. In the text editor, typing `#` in a Markdown link target (`](#` or `](path#`) offers completion of section IDs, each with its heading text and document. Choosing one inserts the path to its document relative to the open file (nothing for the same file) and the ID.

## 7. Saving

1. Edits are saved automatically:
   - before another file is opened,
   - when the browser tab loses focus or the page closes (with `keepalive` requests, for bodies under 60 KB), and
   - every 60 seconds while there are unsaved changes.
2. A file is only written if its text differs from what was last read or saved. Line endings (LF or CRLF), a byte-order mark and the front matter layout are preserved.
3. The save status shows "Saved", "Unsaved changes", "Saving…", "Not saved: changed on disk" or "Save failed" (with the reason as a tooltip).
4. Saving a sectioned file may add or correct section anchors. The editors show them at once: the text editor inserts them without moving the cursor or losing text typed during the save, and undo doesn't remove them. They don't count as unsaved changes. The WYSIWYG view reloads its content.
5. If the file changed on disk since it was opened, saving doesn't overwrite it. A dialog offers **Reload from disk** (discarding the user's changes) and **Keep my version** (overwriting the file on disk). Autosave pauses until the user chooses, and another file can't be opened meanwhile.

## 8. Theme

1. Colors come from one module, `client/src/theme/palette.ts`. Only the light-mode colors are given there:

   | Role | Light mode | Used for |
   | ---- | ---------- | -------- |
   | `text` | `#081f37` | Main document text |
   | `background` | `#fafafa` | Document background |
   | `secondary` | `#5fc9f3` | Secondary buttons and similar fills |
   | `primary` | `#2e79ba` | Primary buttons and similar fills |
   | `navigation` | `#1e549f` | Header, selected tree item, menu highlight |
   | `error` | `#cf4647` | Errors, destructive buttons |
   | `warning` | `#f5d061` | Warnings |

2. The text color on each fill is chosen automatically (whichever of the mode's light and dark text contrasts more) and the fill's lightness is nudged, keeping its hue, until the pair reaches WCAG AA (4.5:1). A unit test checks every pair in both modes.
3. Dark mode is derived in OKLCH: a very dark background and a near-white text color with the hue of `text`, and a darker navigation color. The fills keep their colors, with their text chosen as above.
4. The user switches between light and dark mode with the button in the header. Until they do, the mode follows the browser's preference; their choice is saved in the UI state.
5. The pencil colors of the logo (§9) and the grays of the docs site's favicon are also defined in `palette.ts`, as `logoColors`. A unit test checks that the docs favicon's § reaches 4.5:1 on its tile in both modes.

## 9. Icons

The logo is a section sign (§), for specifications, drawn as two S-shaped strokes that share one closed "o" in the middle. It is drawn in SVG on a 32×32 grid, as paths rather than text, so it doesn't depend on fonts. All variants come from one module, `client/src/theme/logo.ts`.

| Icon | Design | Where |
| ---- | ------ | ----- |
| Favicon | A light § on a rounded tile in the navigation color | The app's browser tab. It is added at startup as a `data:` URI, which the Content-Security-Policy's `img-src` allows (see [Security](security.md) §7). |
| App icon | A page with a folded corner and a § in the navigation color, with a pencil whose tip touches the §'s lower curve | Left of "Specquer" in the header, 24 pixels, with empty alternative text since the name follows it |
| Docs favicon | The favicon's §, light on a dark gray tile, or dark on a very light gray tile when the browser is in dark mode | The documentation site's browser tab (`documentation/public/favicon.svg`); a unit test checks the file matches `logo.ts` |
