<a id="SPEC-00039" data-uid="hqhb8pujtp2h"></a>

<a id="SPEC-00040" data-uid="j3ujxrx9s2cl"></a>
# Specquer Client Requirements

Requirements for the browser user interface (`client/`). They come from [Step 001](/work-items/step-001-doc-editing/requirements), its [implementation plan](/work-items/step-001-doc-editing/implementation-plan), [New File and Folder](/work-items/step-001-doc-editing/new-file-folder), [Step 002](/work-items/step-002-sections/requirements) (sections), [Step 003](/work-items/step-003-section-uids/implementation-plan) (section UIDs and conflicts), [Step 004](/work-items/step-004-hierarchical-summarization/requirements) (the summary slider), [Step 005](/work-items/step-005-summarization-changes/implementation-plan) (summaries from other models), [Step 006](/work-items/step-006-settings/requirements) (the settings dialogs), [Step 007](/work-items/step-007-no-documents-file/requirements) (copied documents) and [Step 008](/work-items/step-008-refactor-settings/requirements) (folder types and prefixes) and [Step 010](/work-items/step-010-document-chat/requirements) (document chat) and [Step 014](/work-items/step-014-all-files/requirements) (All Files, and files other than Markdown). The screen layout is in [Information Architecture](info-architecture.md).

<a id="SPEC-00041" data-uid="n5x7fnnix37v"></a>
## 1. General

1. The UI talks only to its own server over HTTP, through the typed API client. It uses no browser-only APIs it can't do without, so a desktop shell (Tauri, Electrobun) can host it later.
2. Paths and names are validated with the same functions the server uses (`@specquer/shared/paths`).
3. Technologies: React, Tailwind CSS, shadcn components, CodeMirror, Milkdown, the shared unified/remark/rehype pipeline with `hast-util-to-jsx-runtime`, Hono's client, Zod and `yaml`.

<a id="SPEC-00042" data-uid="s48d8v9jo15g"></a>
## 2. Layout

1. The window is split into a folder pane on the left and a file pane on the right, with a drag bar between them.
2. Dragging the bar (or pressing the arrow keys on it) changes the folder pane's width, as a fraction of the window between 10% and 70%. The fraction persists in the UI state.
3. The header holds the app icon and name on the left, and on the right the **Outline** toggle (§14), the **Comments** toggle (§12), the **Chat** toggle (§11), twice the usual gap, the light/dark mode toggle (§8) and, right of it, the **Settings** gear button (§10).
4. The third pane, right of the file pane, shows the outline (§14), the comment threads (§12), the chat (§11) or nothing: the three toggles work as one switch, and opening one pane closes the one open. With it open, a second drag bar separates it from the file pane. Each kind of pane keeps its own width.

<a id="SPEC-00043" data-uid="arb991i3e6ej"></a>
## 3. Folder Tree

1. The tree starts at the root folder, as listed by the server (see [Server Requirements](server-requirements.md) §3), in one of two views chosen above it with **Files shown**, a radio group like the file pane's view selector:
   - **Specs** shows folders and `.md` files only;
   - **All Files** shows every folder and file except those `.gitignore` hides, `node_modules`, `.git` and `.specquer` other than its `shared/` folder.

   Empty folders are shown too, so a new folder appears at once. Both views come with every tree load, so switching between them asks the server nothing. The view persists in the UI state (`treeView`, Specs by default). A view cut at the size limit says so below the tree.
2. Folders come before files; names sort naturally, ignoring case.
3. Clicking a folder expands or collapses it. Expanded folders persist in the UI state, shared by both views.
4. Single-clicking a file opens it in the file pane (§13 for files other than Markdown). The open file is highlighted with the navigation color; switching views keeps it open.
5. Right-clicking a folder or a file opens its context menu ([Step 015](/work-items/step-015-folder-menu/task)), the same for every folder and every file, Markdown or not, in either view:
   - **A folder:** **New file…**, **New folder…**, separator, **Rename…**, **Delete…**, separator, **Add section anchors…** (§3.4), **Settings…** (with a gear icon, §3.6), **Section problems…** (§3.5).
   - **The root folder** (the empty space below the last entry, or an empty tree): the same without **Rename…** and **Delete…**.
   - **A file:** **Rename…**, **Delete…**, separator, **Add section anchors…**, **Section problems…**.

   When an action doesn't apply to an entry, a dialog says why instead, with **Close** only, and nothing is sent: Specquer renames and deletes only Markdown files ("Rename “build.ts” outside Specquer."), only Markdown files have sections, and everything in `.specquer` is Specquer's own data, which Specquer changes itself. Renaming or deleting a folder still takes everything in it along.
6. Each file has an icon for its kind, from its name alone: Markdown (a page with lines), text (a page with code brackets), image, and other files (a blank page).

<a id="SPEC-00044" data-uid="u5s5qfu4wurh"></a>
### 3.1 Rename

1. A modal dialog has a text box with the current name, a **Rename** button and a **Cancel** button.
2. For a file, the text box holds the name without its extension; the extension (`.md`) is shown after the text box and can't be changed. A name typed with the extension, in any case (`spec.md`, `spec.MD`), keeps the file's own extension rather than getting a second one.
3. Rename never moves an entry to another folder.
4. An invalid name (empty, leading or trailing spaces, `/` or `\`, `.` or `..`, control characters, `.git`, `.specquer`, too long) keeps the dialog open with the reason, in the error color.
5. A name already used by a file or folder in the same folder keeps the dialog open with "A file or folder with that name already exists."
6. Unsaved changes to the open file are saved first if the rename affects it. After the rename, the open file follows its new path and the UI state is updated (see [Data Architecture](data-architecture.md) §3.4).

<a id="SPEC-00045" data-uid="o3bvckrfj01t"></a>
### 3.2 New File and New Folder

1. A modal dialog has an empty text box, a **Create** button and a **Cancel** button. It is titled **New file** or **New folder** and names the folder the entry is created in ("the root folder" for the root).
2. For a file, the extension (`.md`) is shown after the text box and added to the name, unless the name typed already ends with it, in any case (`spec.md` and `spec.MD` both create `spec.md`); a folder's name has no extension.
3. Invalid names and names already used in the folder keep the dialog open with the reason, as for rename (§3.1, items 4 and 5).
4. After creating the entry, the folder it was created in (unless it is the root) is expanded and the tree is reloaded, so the new entry shows.
5. A new file is created empty, or with its root section anchor if it is sectioned, and opened in the file pane (saving the previously open file first, as for any file switch).
6. In a sectioned folder, the **New file** dialog also has **Prefix**, starting from the folder's default prefix and checked as in §3.6; the root anchor's ID takes it. A prefix other than the default is the file's own: its new sections take it.
7. The **New folder** dialog also has the folder type and default prefix fields of §3.6, both starting as inherited. A `.specquer-config.yaml` is written only for values that differ from the inherited ones.

<a id="SPEC-00046" data-uid="b3odkybydlfb"></a>
### 3.3 Delete

1. A modal dialog has a **Delete** button (error color) and a **Cancel** button.
2. For a folder, the dialog lists every file that will be deleted, including files the tree doesn't show, and how many of them the tree doesn't show.
3. The dialog names the files that aren't committed to Git and can't be recovered. If the root isn't in a Git repository, it says so.
4. Deleting the open file, or a folder containing it, closes it. The UI state drops every entry for deleted paths.

<a id="SPEC-00047" data-uid="w748uemplxzf"></a>
### 3.4 Add Section Anchors

1. It is opened with **Add section anchors…** in a folder's or a file's menu (§3), for everything in the folder or for that file alone. The open file is saved first.
2. A modal dialog says how many sectioned files in the folder (or whether the file) will change and lists them, with **Add anchors** and **Cancel** buttons; when none would change it says so and offers only **Close**. When the folder holds no sectioned files, or the file isn't in a sectioned folder, it says so ("Folder “notes” holds no sectioned files. Section anchors are added only in sectioned folders; see the folder's Settings…").
3. Adding the anchors rewrites those files (see [Server Requirements](server-requirements.md) §6). If the open file was among them, it is reloaded.
4. While the root folder's `AGENTS.md` lacks the section anchor rules for coding agents, the dialog, for a folder, offers to add them with a checkbox, unticked. Ticked, the dialog can run even when no file needs anchors (**Add to AGENTS.md**).

<a id="SPEC-00048" data-uid="v328rz9e2tip"></a>
### 3.5 Section Problems

1. It is opened with **Section problems…** in a folder's or a file's menu (§3). The open file is saved first.
2. A modal dialog lists the problems in the folder's sectioned files, or those involving the file (with their other side: a duplicate ID's occurrences in other files, both copies of a copied document). When the folder holds no sectioned files, or the file isn't in a sectioned folder, it says so, and still lists the problems that need none, such as a nested Specquer folder. The problems are: folders below the root with a `.specquer/` of their own (another Specquer's data, ignored here, to check and delete), whole files copied when Specquer can't tell the original from the copy, IDs used by copies of one section in several documents, IDs used by different sections (two branches issued one number), stray anchors (with their line), files with merge conflict markers, statuses that aren't allowed for their section's prefix (with their line), and unusable `prefix.config.yaml` files of the prefixes the folder holds (the prefix then uses the default statuses).
3. Each occurrence opens its file, at the section. Each occurrence of a duplicate or colliding ID that doesn't keep the ID has **Renumber**, which gives it a new number; each file of a copied document has **Renumber this copy**, which renumbers all its sections (the open file is saved first and reloaded after). The list then reloads.

<a id="SPEC-00108" data-uid="szimo5b2q5wk"></a>
### 3.6 Folder Settings

1. A modal dialog, **Folder settings**, edits the folder's `.specquer-config.yaml` (see [Data Architecture](data-architecture.md) §2.3).
2. **Folder type** has five choices: **Inherited** (no type of its own; the dialog says where the type comes from and what it is, e.g. "from documentation: Baseline", or "non-sectioned" when no folder above sets one), **Baseline**, **Change**, **Auxiliary** and **Non-sectioned**, each with a one-line description.
3. **Default prefix** shows for a sectioned type, starting from the folder's own prefix or else the inherited one, which the help text names. It is typed in upper case and checked as the section ID prefix (an upper-case letter and 1 to 4 upper-case letters or digits); an invalid prefix, or none for a sectioned type, is reported under the field. A prefix equal to the inherited one is saved as inherited. Several folders may share a prefix.
4. Saving writes only the values that differ from the inherited ones; a file left with nothing is deleted. The type and prefix fields are shared with the new folder dialog.
5. **Add section anchors** is in the folder's menu (§3), not in this dialog ([Step 015](/work-items/step-015-folder-menu/task)).
6. **Save** is enabled once the setting changed and is valid. When the save makes the folder sectioned, the dialog says so and offers **Add section anchors…** and **Close**; when it stops being sectioned, it says the anchors stay in the files and the sections keep their IDs if it is sectioned again.
7. If the file changed on disk since the dialog read it, the save is refused, the dialog reloads the settings and says so. A file that isn't valid YAML is reported and can't be saved to until it is fixed by hand.

<a id="SPEC-00049" data-uid="g5tal9mne58o"></a>
## 4. File Path

1. The open file's path is shown from the root folder as a shadcn breadcrumb.
2. When the path doesn't fit, leading folders are replaced by one "…" (its tooltip shows the hidden folders). The file name is never hidden.
3. Once there are recent files, the file name becomes a drop-down listing up to ten of them (most recent first, not counting the open file). Choosing one opens it.

<a id="SPEC-00050" data-uid="drv6ct4jpecs"></a>
## 5. Front Matter

1. The front matter is edited in its own CodeMirror editor with YAML highlighting, between the file path and the content. The `---` delimiters are not shown.
2. The editor starts one line high for a file without front matter and three lines high otherwise.
3. A drag bar below the editor changes its height; the height is remembered per file in the UI state.
4. Typing into the editor of a file without front matter adds a front matter block; clearing the editor removes the block.
5. There is no schema. Invalid YAML is kept and saved as typed; the editor shows an "Invalid YAML" marker in the warning color, with the parser's messages as a tooltip.

<a id="SPEC-00051" data-uid="z5ma56k27geg"></a>
## 6. Markdown Content

1. The content can be shown in four view types: **Text** (CodeMirror, Markdown mode), **Split** (CodeMirror and preview side by side), **Preview** (read-only) and **WYSIWYG** (Milkdown).
2. The view type is persisted per file; files open in Text the first time.
3. One in-memory copy of the file is shared by all views; switching views keeps unsaved changes.
4. The preview is produced by the shared pipeline in a Web Worker and rendered with `hast-util-to-jsx-runtime`. In the split view it updates about 250 ms after typing stops; results for outdated text are dropped. Fenced code blocks with a language (highlight.js's `common` grammars, by name or alias, in any case) are highlighted in the palette's token colors; code without a language, with another one, indented code and blocks with a line over 10,000 characters stay plain. The grammars load in the worker only, so where no worker runs code stays plain.
5. In the preview, links to other `.md` files in the workspace open them in Specquer, in-page links scroll, and other links open in a new tab. A link to a section of another document (`other.md#REQ-00012`) opens it and, in the preview, scrolls to the section.
6. Raw HTML in the preview is sanitized (see [Security](security.md) §6).
7. Opening a file in WYSIWYG without editing it never changes the file; Milkdown's output is used only after the user changes something (Milkdown rewrites some Markdown, such as list markers, tables and reference links).

<a id="SPEC-00052" data-uid="u4ps6ydi8prg"></a>
### 6.1 Sections

1. In the preview and split views, a badge stands for each section anchor: at the start of a heading, between a list item's marker and its content, and at the top for the root section. The anchor itself stays invisible. The badge is the favicon (§9).
2. Hovering or focusing a badge shows a tooltip with the section ID and its status ("SPEC-00012 - Peer Review"; an inherited status is followed by "(inherited)", and a status of its own that isn't allowed by "(not allowed)", see §6.3), the document path and the section's UID. Badges can be reached with the keyboard. Clicking one does nothing.
3. The WYSIWYG view shows anchors as badges too, laid out as in the preview (a heading's badge at the start of the heading, at its size), and saves them unchanged. The cursor never stops on the hidden line that holds a heading's anchor. Its badges can be focused; their tooltip (the browser's) holds the section ID and status.
4. In the text editor, typing `#` in a Markdown link target (`](#` or `](path#`) offers completion of section IDs, each with its heading text and document. Choosing one inserts the path to its document relative to the open file (nothing for the same file) and the ID.
5. A badge whose ID is also used elsewhere, or whose own status isn't allowed, has a warning ring. For an ID used elsewhere, the badge's tooltip names the other occurrences, says whether this one keeps the ID, and offers **Renumber this one** (saving the open file first).
6. Pasting a section anchor whose ID still exists elsewhere (in the open document, or, in the text editor, in another document) turns it into a placeholder, so the copy gets a new ID on save. A cut followed by a paste keeps the ID.
7. In the text editor, section anchors (and placeholders, `<a id=""></a>`) are faded: shown in the muted color, made lighter still, so the eye skips them. They aren't folded or hidden, and stay editable as text.
8. Right-clicking a badge (in the preview, split and WYSIWYG views), or pressing the context-menu key or Shift+F10 on a focused one, opens a menu with **Copy this section ID** (which copies it and, in the preview, confirms it in the tooltip) and **Section attributes…** (§6.3). **Section attributes…** is left out in a file that isn't sectioned, and disabled, with a tooltip saying why, in a file with merge conflict markers.

<a id="SPEC-00053" data-uid="t3nnmebbri6x"></a>
### 6.2 Summaries

1. In the preview and split views, a slider above the preview replaces heading sections with AI summaries, level by level. It has one stop per heading level the document uses plus two: the full text (the far right, the default) and the whole document (the far left). Skipped and unused levels add no stops. A document without headings shows no slider.
2. Each step to the left summarizes the sections of the next higher level used, with everything below them; a section deeper than that level that isn't inside one of them is summarized too. A summarized section keeps its heading, with the summary under it. Text under a heading before its first subsection, and the text before the first heading, stay as written. At the far left one summary replaces the whole document, headings included.
3. The stops are named "Full text", "Summarize level 3 sections", …, "Summarize document"; the current one is shown beside the slider and is the slider's accessible value text. The slider is reached and moved with the keyboard.
4. The position is remembered per file in the UI state, as steps from the full text, and clamped to the stops the document has.
5. Until a model is configured and its key set, the slider is disabled, the preview shows the full text, and a hint names `.specquer/shared/agent.config.yaml` (with the reason as a tooltip). The client asks the server whether summaries are enabled when the page loads, whenever the tab gets focus and after the settings are saved (§10), so a configuration change needs no reload.
6. A section of fewer than 60 words (after simplification) is shown as written, without calling the model. A section added since the last save is shown as written until it is saved.
7. A summary shows "Summarizing..." with a spinner while it is made (the spinner stays still when the system asks for reduced motion); then plain text paragraphs, never Markdown or HTML, under a subtle label: "AI summary", the name of the model that made it (the part after the last `/`, with the full ID as a tooltip), and "shortened" when the section was too long and was cut. If it can't be made (a network failure, the provider's rate limit), the error shows in its place with **Retry**.
8. Summaries are made from the saved file only; unsaved text is never sent. A section edited since the last save keeps its last summary, labeled "out of date", and is summarized again after the next save.
9. The Outline follows the slider: it shows only the sections the slider leaves visible (§14 item 7).
10. Clicking a summary, or its **Show full text**, moves the slider to the full text and scrolls to its section. A link to a section hidden by a summary (`other.md#SPEC-00012`) does the same.
11. Summaries are kept in memory while Specquer is open, so moving the slider back and forth asks for nothing new. At most three summary requests are in flight at once, in document order, so they never take all of the browser's connections to the server and saves and file loads don't wait behind them. Requests no longer needed (the slider moved, another file opened, another view chosen) are aborted, or dropped before they are sent.
12. A summary another model made (or an older prompt) is shown at once, labeled "older model", while the configured model's is made; it is asked for after the summaries the preview still needs, and replaces the older one in place. If it can't be made, the older summary stays, with the error and **Retry**.

<a id="SPEC-00113" data-uid="omkqex82dhaa"></a>
### 6.3 Section Status

1. Each section has a status: its anchor's `data-status`, or, without one, the status it inherits: its parent section's within the same prefix, and the first allowed value of its prefix at the root or where the prefix changes (see [Data Architecture](data-architecture.md) §2.9). The badges show it (§6.1). Statuses are worked out from the text being edited, so they follow unsaved changes.
2. **Section attributes…** opens a modal dialog, **Section attributes**, naming the section by its ID and title, with a **Status** drop-down: **Inherited (`<status>`)** (what the section would inherit), then the allowed values of its prefix, in order. It starts on the section's own status, or **Inherited** when it has none; an own status that isn't allowed is shown as a disabled choice, "Revieww (not allowed)".
3. **OK** sets the status in the editor's buffer: it adds, changes or removes (for **Inherited**) the anchor's `data-status`, written after `data-uid`. The dialog never writes to disk: the change is an ordinary unsaved edit, saved like any other. In the text editor (split view) and the WYSIWYG view it is undone with Ctrl+Z like typing. OK without a change, or with the invalid status still chosen, changes nothing.
4. A status that isn't allowed, and a prefix's unusable `prefix.config.yaml`, are section problems (§3.5).

<a id="SPEC-00054" data-uid="r7go3dfjt7wm"></a>
## 7. Saving

1. Edits are saved automatically:
   - before another file is opened,
   - when the browser window loses focus (switching to another application often leaves the tab visible; [Step 012](/work-items/step-012-comment-threads/requirements) R9),
   - when the browser tab is hidden or the page closes (with `keepalive` requests while their JSON bodies, measured in UTF-8 bytes, fit in 60,000 bytes together: browsers count the keepalive requests in flight together and refuse one over 64 KiB, so the document goes first, then the UI state and a comment draft, and a body that doesn't fit is sent without `keepalive`), and
   - every 60 seconds while there are unsaved changes.
2. Every save first takes the edits the WYSIWYG view hasn't reported yet (Milkdown reports them 200 ms after the last change), so a quick switch away doesn't leave them out. A file is only written if its text differs from what was last read or saved. Line endings (LF or CRLF), a byte-order mark and the front matter layout are preserved.
3. The save status shows "Saved", "Unsaved changes", "Saving…", "Not saved: changed on disk" or "Save failed" (with the reason as a tooltip). "Unsaved changes" is a button (accessible name "Unsaved changes: save now") that saves at once, which also brings summaries up to date (§6.2); in the other states the status is plain text.
4. Saving a sectioned file may add or correct section anchors. The editors show them at once: the text editor inserts them without moving the cursor or losing text typed during the save, and undo doesn't remove them. They don't count as unsaved changes. The WYSIWYG view reloads its content. When the save changed more than adding anchors (a copy renumbered, an edited ID put back, a reused number, a copied UID, or a file with conflict markers left alone), a dismissible line under the file path says what, with a link to **Section problems…**.
5. If the file changed on disk since it was opened, saving doesn't overwrite it. A dialog offers **Reload from disk** (discarding the user's changes) and **Keep my version** (overwriting the file on disk). Autosave pauses until the user chooses, and another file can't be opened meanwhile.

<a id="SPEC-00055" data-uid="vcjbkxfhmoor"></a>
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
   | `folder` | `#dcc196` | The sepia fill inside folder icons in the tree |

2. The text color on each fill is chosen automatically (whichever of the mode's light and dark text contrasts more) and the fill's lightness is nudged, keeping its hue, until the pair reaches WCAG AA (4.5:1). A unit test checks every pair in both modes.
3. Dark mode is derived in OKLCH: a very dark background and a near-white text color with the hue of `text`, and a darker navigation color. The fills keep their colors, with their text chosen as above.
4. The user switches between light and dark mode with the button in the header. Until they do, the mode follows the browser's preference; their choice is saved in the UI state.
5. Folder icons in the tree are outlined in the text color and filled with `folder`; dark mode uses a darker sepia, so folders don't glow. The outline stays at least 3:1 (WCAG AA for graphics) against the fill in both modes, which a unit test checks.
6. The pencil colors of the logo (§9) and the grays of the docs site's favicon are also defined in `palette.ts`, as `logoColors`. A unit test checks that the docs favicon's § reaches 4.5:1 on its tile in both modes.

<a id="SPEC-00056" data-uid="vb26hxtvldyd"></a>
## 9. Icons

The logo is a section sign (§), for specifications, drawn as two S-shaped strokes that share one closed "o" in the middle. It is drawn in SVG on a 32×32 grid, as paths rather than text, so it doesn't depend on fonts. All variants come from one module, `client/src/theme/logo.ts`.

| Icon | Design | Where |
| ---- | ------ | ----- |
| Favicon | A light § on a rounded tile in the navigation color | The app's browser tab. It is added at startup as a `data:` URI, which the Content-Security-Policy's `img-src` allows (see [Security](security.md) §7). |
| App icon | A page with a folded corner and a § in the navigation color, with a pencil whose tip touches the §'s lower curve | Left of "Specquer" in the header, 24 pixels, with empty alternative text since the name follows it |
| Docs favicon | The favicon's §, light on a dark gray tile, or dark on a very light gray tile when the browser is in dark mode | The documentation site's browser tab (`documentation/public/favicon.svg`); a unit test checks the file matches `logo.ts` |

<a id="SPEC-00109" data-uid="akfpygc8p5eb"></a>
## 10. Settings

1. The **Settings** gear button opens a modal dialog, **Settings**, with the agent configuration's settings (see [Data Architecture](data-architecture.md) §4.2) in tabs: **Model**, **Summarization** and **Chat**.
2. Each tab has a **Personal** / **Shared** choice, starting on **Personal**, which says the file it saves to: `.specquer/user/agent.config.yaml` (for this user only, overriding the shared file) or `.specquer/shared/agent.config.yaml` (committed, for everyone using the repository). Switching with unsaved changes on the tab asks to discard them first.
3. In **Personal** each value is the one in effect, with a badge saying where it comes from: **Personal**, **Shared** or **Default**. A personal value has **Reset**, which removes it from the personal file on save, so the shared value applies again. In **Shared** each value is the shared file's (or the default), marked when a personal value overrides it.
4. **Model** tab: the provider (NVIDIA, read only), the model ID (free text; Specquer offers no list of models), the base URL and the API key variable. The key itself is never asked for, shown or saved, only the name of the variable that holds it; the tab says whether the server has that variable ("found" or "not set"), and when it isn't set, that Specquer reads its environment only at startup and must be restarted after it is set. The model status (summaries on with which model, or why they are off) is shown. The model is saved as a whole: changing any field writes the complete `model:` block, and **Reset** resets all of it.
5. **Test** sends one short fixed prompt, with nothing from the specs, to the model as entered, saved or not, and shows how long the answer took or what went wrong (a rejected key, an unknown model, an unreachable URL, no answer within 30 seconds, or the provider's message). The tab names the URL the key will be sent to. A running test can be cancelled; a new one stops the one running.
6. **Summarization** tab: concurrent model calls (1 to 16, for summaries and the chat together), the token budget (1,000 to 1,000,000) and **Pre-fill summaries in the background**. Switching pre-filling on warns that the server will send every section of every Markdown file to the model provider in the background, again after each change; in **Shared** it adds that this applies to everyone who pulls the change, and saving asks for confirmation (**Switch on for everyone**).
7. **Chat** tab: sections per question (1 to 20), their token budget (1,000 to 100,000), earlier questions sent (0 to 50), their token budget (0 to 100,000) and the longest answer in tokens (256 to 32,000), each with its source badge and **Reset** as on the other tabs.
8. Invalid values are reported under their field and keep **Save** disabled. **Save** writes the changes of all tabs, one save per file, and closes the dialog; **Cancel** discards them. A file that changed on disk since the dialog read it is not overwritten: the dialog reloads the values and says so. Values a file holds that are invalid are listed at the top of the tab, and a file that isn't valid YAML can't be saved to until it is fixed by hand.
9. Saved settings take effect without a restart, except a key variable that wasn't set when Specquer started (item 4).
10. **Approval.** Shared settings that wait for this user's approval ([Security](security.md) §9) are named at the top of the dialog, above the tabs: a shared model sending its key to an endpoint other than the default (the variable and the URL, with **Approve this model**) and shared pre-filling (with **Approve pre-filling**). Approving takes effect at once, and the dialog reloads its values. Saving to the shared file approves what is saved. The base URL must be `https`, or `http` to this machine only.

<a id="SPEC-00114" data-uid="z8y8hs5v3kss"></a>
## 11. Chat

From [Step 010](/work-items/step-010-document-chat/requirements).

1. **The pane.** The **Chat** button (a toggle with `aria-pressed`; a speech bubble with its tail at the lower right and a small four-point star inside) opens and closes the chat pane, closing the Comments pane (§12), to the right of the file pane, with a drag bar between them. Its width is a fraction of the window from 0.15 to 0.5 (default 0.3). The file pane keeps at least 30% of the window: a drag bar stops there, and when the folder and chat panes together are too wide the chat pane gives way first. Whether the pane is open and its width persist in the UI state. Every view stays available with the pane open.
2. **Without a model or key** the pane opens, but the input is disabled with a hint naming `.specquer/shared/agent.config.yaml` and the reason as a tooltip.
3. **Asking.** **Enter** sends; **Shift+Enter** starts a new line; Enter during an input method's composition confirms it instead; a blank input sends nothing; a question holds at most 8,000 characters. Sending first saves the open file's changes, as autosave would; if the file changed on disk the question waits for the conflict dialog, and if the save fails the question stays in the input. `/clear` clears the conversation; another `/command` is reported as unknown and not sent. One question is answered at a time.
4. **Answers** stream in as the model writes them, after "Saving the open file...", "Searching the specs..." and "Thinking..." with a spinner. Questions sit against the right edge, as typed (at most 85% wide, lines left-aligned); answers against the left, in the AI box shared with summaries, labeled "AI response", the model's short name (the full ID as a tooltip), the thinking time ("12 s", "1 min 12 s"; the full time from the server receiving the question to the end of the answer) and the clock time (with the date when it isn't today).
5. **Rendering.** Answers are limited Markdown, rendered again at most every 150 ms while streaming: paragraphs, bold and italic, strikethrough, lists, inline code and code blocks, block quotes and tables. Raw HTML, images, links and autolinks the model writes, footnotes and front matter are shown as text, and headings as bold paragraphs. The only links are citations ([Security](security.md) §9).
6. **Citations.** A `[n]` marker is a link only when the server listed source `n` for the answer; a **Sources** line under the answer lists those cited, by title. Opening one looks its section ID up first, so it follows a section moved since; without an ID it opens the file at the heading by its outline path (at the top if the heading is gone). The file opens in Preview (Text and WYSIWYG switch to Preview, which is remembered; Split and Preview stay), scrolled to the section, with the summary slider moved to the full text if a summary hides it. A citation without an ID whose file is gone is shown as text, marked "no longer exists".
7. **Stop and errors.** **Stop** replaces **Send** while an answer is under way; the text so far stays, labeled "stopped after …". With nothing received yet, the question goes back to the input. A failure (the provider's rate limit, a network error) shows in the answer's place with **Retry**, keeping any text received.
8. **History.** The conversation is loaded when the pane opens and whenever the tab gets focus, and repainted as first shown. **Clear** (or `/clear`) empties it; for ten seconds **Undo** puts it back. Each answer has **Copy**, which copies its Markdown.
9. **Accessibility.** A streaming answer has `aria-busy`; the finished answer is announced once through a polite live region. The list follows a streaming answer unless the user has scrolled up.

<a id="SPEC-00115" data-uid="f877buudm67m"></a>
## 12. Comment Threads

From [Step 012](/work-items/step-012-comment-threads/requirements).

1. **The pane.** The **Comments** button (a toggle with `aria-pressed`; a hollow, rounded speech bubble with its tail at the lower left) opens and closes the Comments pane in the third pane's place (§2), closing the chat. Its width (0.15 to 0.5 of the window, default 0.3), whether it is open and its filter persist in the UI state.
2. **Threads.** A thread is about one section of the open document, identified by the section's UID; a section may have several. It is **Open** or **Resolved**, and holds Markdown comments, each with who created it and when, and, once edited, who changed it last and when (shown as "edited", with both in its tooltip). Times are shown in the browser's locale. Names come from Git (`user.name`, else `user.email`) or the login name; anyone can edit or delete any comment. Sections with a UID in sectioned folders can have threads, the root section and list items included; a section that hasn't been saved with its UID can't yet.
3. **Groups.** The pane shows the open document's threads that the filter (**Open**, **Resolved** or **All**; Open by default) shows, grouped by section in document order, from the text being edited. A group's header shows the section ID, title and status; clicking it scrolls the document to the section and flashes it. Threads whose section isn't in the text being edited are listed last, as **Detached**. The pane says how many threads the filter hides.
4. **Threads in the pane** start collapsed (first comment, author, number of replies, status) and expand on click. An Open thread offers **Reply**, **Edit** and **Delete** on its comments, **Resolve** and **Delete thread**; a Resolved one is read-only and offers **Reopen** and **Delete thread**; a detached one can be resolved, reopened and deleted. The latest change of status is shown ("Resolved by …, date"). **+ New thread** on a group's header (or **Add comment…** on a badge) collapses the section's other threads and opens an editor. A thread's first comment can be deleted only while it has no replies, which deletes the thread; **Delete thread** asks first.
5. **Writing.** Comments are written in a WYSIWYG Milkdown editor, which takes the focus when it opens. A comment is saved when its editor loses focus: clicking elsewhere closes the editor; when the window loses focus the comment is saved and the editor stays open, so what follows edits the saved comment. A Save button under the editor does the same as clicking elsewhere, for users who look for one. Escape closes the editor without saving (a new comment is discarded); a new comment left empty, an unchanged one and a cleared one (which gets its text back) write nothing. Links and images, typed or pasted, become their text and URL as plain text.
6. **Rendering.** Comments are the chat answers' limited Markdown (§11 item 5); links, images (inline, by reference, autolinks and bare URLs) show as their text or alt text followed by the URL, as text.
7. **Changes on disk.** Each change is applied to the comment file as it is on disk, so threads changed there meanwhile (a Git pull) are kept. An edit to a comment changed on disk since it was loaded isn't saved: the pane says so and shows the comment as it is now. The threads are loaded again after each save of the document and when the window regains focus.
8. **Pips.** A section with threads the filter shows has a pip beside its badge (in the preview and the WYSIWYG view) or on its anchor's line in the text view's gutter: a small speech bubble with the number of its own threads, the first line of each in its tooltip, named "2 open comment threads". Clicking it opens the Comments pane at the section. While the summary slider hides sections, their threads are counted on the nearest shown ancestor's pip ("3 (2 hidden)"). The text view's gutter is hidden from assistive technology, as CodeMirror's gutters are.
9. **Highlighting.** Hovering or focusing a group or thread in the pane tints its section, subsections included (a list item with its nested items), in all three views; hovering a pip tints the section's group in the pane. Moving to a section from the pane or with F8 flashes it (a steady tint with reduced motion).
10. **Badge menu.** A section badge's menu gains **Add comment…** (disabled, with the reason, for a section without a UID yet or when the comment file can't be used) and, for a section with threads, **Show comments**.
11. **Following the document.** As the document scrolls, the pane scrolls to the group of the section at the top, or of the nearest one above it with threads, unless the pointer is over the pane or the focus is in it.
12. **F8 and Shift+F8** move to the next and previous thread the filter shows, in document order, wrapping around: they open the pane, expand and focus the thread, and scroll the document to its section.
13. **Files.** Renaming or deleting a document also renames or deletes its comment file, and the delete dialog lists it. Unusable and orphaned comment files and detached threads are listed in **Section problems…** (§3.5).

<a id="SPEC-00127" data-uid="r2pvk6k274nm"></a>
## 13. Files Other Than Markdown

From [Step 014](/work-items/step-014-all-files/requirements). Specquer edits Markdown files only; every other file is shown view-only. Such files have the same menu as any file (§3), whose **Rename…**, **Delete…**, **Add section anchors…** and **Section problems…** say why they don't apply.

1. **Opening.** A file other than Markdown opens as a Markdown file does, after the open document is saved (staying put on a conflict or a failed save). The file pane then shows its path with the recent files, and no save status, view selector, front matter editor, summary slider or comment pips. It joins the recent files, and opens again at start-up when it was open last.
2. **Text files** (UTF-8 without NUL bytes, at most 5 MB) are shown as the preview shows one fenced code block holding the whole file, built from the text directly, so nothing in the file is read as Markdown or HTML. The language comes from the file name (`index.ts` is TypeScript, `Makefile` is Make); a file of another kind is plain text. A gutter numbers the lines; it stays in place when the code scrolls sideways, isn't copied with the text and is hidden from assistive technology. A file with a line over 10,000 characters isn't highlighted. A file changed on disk shows its new content when it is next opened.
3. **Images** (PNG, JPEG, GIF, WebP, AVIF, SVG, BMP and ICO, at most 5 MB) are shown over a checkerboard, scaled down to fit the pane; clicking the image, or Enter on it, switches to actual size, where the pane scrolls, and back. A line under it gives its pixel size and file size. SVG is shown only as an image.
4. **Anything else** shows a placeholder with the file's size and why it can't be shown: "This file type cannot be displayed by Specquer.", "This file isn't UTF-8 text, so Specquer can't display it.", "This file is too large to display." or, for an image that doesn't decode, "This image can't be displayed."
5. **Comments.** While such a file is open, the Comments pane says that comments are available for Markdown files in sectioned folders.

<a id=""></a>
## 14. Outline

From [Step 016](/work-items/step-016-right-pane-section-nav/requirements).

1. **The pane.** The **Outline** button (a toggle with `aria-pressed`; Lucide's table of contents icon), left of **Comments**, opens and closes the Outline in the third pane's place (§2). Its width (0.15 to 0.5 of the window, default 0.3) and whether it is open persist in the UI state.
2. **The tree** (`role="tree"`, named "Outline") holds the open document's sections, as the text being edited holds them, at most a quarter of a second after typing stops: headings nested by level, and the items of sectioned lists under their heading. The root section isn't an item. In a document that isn't sectioned, the tree holds its headings. It is worked out in the preview worker.
3. **Items** are one line each, cut with "…", their full text in a tooltip: a heading's text, or a list item's section ID and first eight words. A section's icon is its badge (with the warning ring of an ID used twice or a status that isn't allowed), a heading without a section a plain heading icon. The icon has no menu.
4. **Expanding and collapsing.** An item with items below it has a chevron; clicking the chevron, the icon or the space left of them expands or collapses it. Everything starts expanded; collapsed items persist per file in the UI state, by section UID, or by outline path in a document that isn't sectioned.
5. **Moving.** Clicking an item's text, or the space right of it, scrolls the file pane to its section in any view (both sides in Split) and highlights the item in the navigation color. The focus stays in the tree.
6. **Following.** As the file pane scrolls, the highlight moves to the section at its top (the first item above the first heading), and the row is scrolled into view unless the pointer is over the pane or the focus is in it. A clicked item stays highlighted until the reader scrolls. A highlight inside a collapsed or summarized item shows on that item, fainter.
7. **The summary slider.** In the Preview and Split views, the tree shows only what the slider leaves visible: a summarized section stays, marked "summary", without the items below it; with the whole document summarized the pane says so. The Text and WYSIWYG views show every section.
8. **Keyboard.** One item is in the tab order. Up and Down move between items, Home and End to the first and last; Right expands or moves to the first child, Left collapses or moves to the parent; Enter and Space move the file pane to the section.
9. **Other states.** A file other than Markdown shows "(Not Markdown)"; with no file open, "Open a document to see its outline."; a document without headings, "This document has no headings."
10. **Add section anchors…**, a link under the tree, opens **Add section anchors** for the open file (§3.4).

