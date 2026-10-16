<a id="WORK-00630" data-uid="djhnxcabeaqp"></a>

<a id="WORK-00631" data-uid="s79rabdihub8"></a>
# Step 016 - Outline

_Requirements for an Outline pane: a tree of the open document's sections in the third pane, for moving around the document and seeing where one is. Drafted October 2026 from [the notes](notes.md), which call it the "Table of Contents", and revised with the answers to the first review: the feature is called **Outline**, on screen and in code. The decisions are in §7._

<a id="WORK-00632" data-uid="os2r9pltro2w"></a>
## 1. Summary

Long specs are hard to move around in: the preview has no outline, and the comment pane's groups only list sections with threads. Step 016 adds a third kind of pane, beside **Chat** and **Comments**:

- **Toggle:** an **Outline** button in the header, left of **Comments**, opens and closes the pane. The three panes take turns: opening one closes the other (R1).
- **The tree:** the open document's sections, nested as in the document, each with its section badge and its heading. A document that isn't sectioned shows its headings (R2, R3).
- **Expanding and collapsing:** by the badge or the space left of it, remembered per document, everything expanded at first (R4).
- **Moving:** clicking a section's text scrolls the file pane to it and highlights it (R5).
- **Following:** as the file pane scrolls, the highlight follows the section at the top (R6).
- **The summary slider:** the outline shows only the sections the slider leaves visible (R7).
- **Other files:** a file that isn't Markdown shows "(Not Markdown)" (R9).
- **Add section anchors…:** a link under the tree, as in the file's menu ([Step 015](/work-items/step-015-folder-menu/task)) (R10).

<a id="WORK-00633" data-uid="k6gqcdthi0f6"></a>
## 2. Precedence

Step 016 takes precedence over the specifications and earlier steps where they conflict:

| Topic | Before | Step 016 (wins) |
|---|---|---|
| The third pane (Client Requirements §2 item 4, Step 012 R1.3) | Chat, comments or nothing: a two-way toggle plus off | Outline, comments, chat or nothing: one of three toggles at a time (R1.3) |
| The header (Client Requirements §2 item 3) | **Comments**, **Chat**, gap, theme, **Settings** | **Outline**, **Comments**, **Chat**, gap, theme, **Settings** (R1.1) |
| UI state (Data Architecture §3) | `sidePane: "chat" \| "comments" \| null` | Also `"outline"`; `outlinePaneFraction`; per file, the collapsed items (R11) |

<a id="WORK-00634" data-uid="ng37lgcyhj6t"></a>
## 3. Requirements

<a id="WORK-00635" data-uid="oy13ldc2ekre"></a>
### R1. The Pane and Its Toggle

1. **The button:** an **Outline** toggle in the header, left of the **Comments** toggle, with the same look as the other two: an icon button with `aria-pressed` and the tooltip "Outline". Its icon looks like a table of contents: lines of text with indented lines below them (Lucide's `TableOfContents`).
2. **The pane:** the outline opens in the third pane's place, right of the file pane, with a drag bar between them, as the chat and the comments do. Its heading is "Outline".
3. **One at a time:** the three toggles work as one switch. Opening the outline closes the chat or the comments, and opening either of them closes the outline. Pressing the open pane's toggle closes it.
4. **Width:** the pane has its own width, a fraction of the window from 0.15 to 0.5, by default 0.3, with the file pane keeping at least 30% of the window, as for the other two panes.
5. **Kept:** which pane is open, and the outline's width, are kept in `uistate.yaml` (R11).

<a id="WORK-00636" data-uid="ipakscf7sxwo"></a>
### R2. The Tree

1. **A sectioned document:** the sections of the document open in the file pane, as the text being edited holds them, nested as in the document: a heading's section holds the headings below it of a deeper level, and the list items sectioned within it. (Only the items of top-level lists are sections; an anchor in a nested item is a stray, so items have no items below them.)
2. **A document that isn't sectioned** (outside a sectioned folder) has no sections, so the tree shows its headings, nested by level, without list items.
3. **The root:** the document's root section isn't an item of its own; its sections are the tree's top level. The file name is already in the path above the file pane.
4. **Order:** document order.
5. **Updates:** the tree follows edits in the Text, Split and WYSIWYG views, at most a quarter of a second after typing stops, keeping what is expanded, collapsed and highlighted. A section added appears; one deleted disappears.
6. **Empty:** a Markdown document without sections or headings says so: "This document has no headings."
7. **Accessibility:** the tree is a `tree` with `treeitem`s and `group`s, named "Outline", with the keyboard of a tree view (R12).

<a id="WORK-00637" data-uid="nilbousr7o80"></a>
### R3. The Items

1. **An item** is one row: an icon, then its text. Rows never wrap: text too long for the pane is cut with "…", and its full text is in the item's tooltip.
2. **The icon** of a section is its badge, as in the preview and WYSIWYG views (the § icon, with its status and problem marks as there). A heading in a document that isn't sectioned has a plain heading icon instead (Lucide's `Heading`). In the tree the icon has no menu; it expands and collapses (R4).
3. **A heading's text** is the heading, as plain text without Markdown markup.
4. **A list item's text** is its section ID followed by the item's first words and "…": `REQ-00042 The user can reset a password …`, the words the section's title already holds (its first eight).
5. **A section not saved yet** (a placeholder `<a id="">`, or a heading written since the last save) appears with its text and without a badge until a save gives it its ID.

<a id="WORK-00638" data-uid="pq8jjwkxq31c"></a>
### R4. Expanding and Collapsing

1. **Which items:** only items with visible items below them can be expanded (R7); the others have no expander.
2. **How:** clicking an item's icon, or the empty space left of it (its indentation), expands it if collapsed and collapses it if expanded. The keyboard does the same (R12).
3. **The default:** every item starts expanded.
4. **Kept per document:** the items collapsed are kept in `uistate.yaml` per document, so they stay collapsed after a reload and a restart (R11.2).
   - **Sections** are kept by UID, so they stay collapsed after edits that move them. Sections without a UID yet can be collapsed for as long as the document stays open.
   - **Headings** in a document that isn't sectioned are kept by their place in the outline (`0.2.1`, the path the summaries use), so a heading inserted above them can move which one is collapsed.
5. **Highlighted inside a collapsed item:** when the highlighted item (R5, R6) is inside a collapsed item, the collapsed item shows as highlighted, more faintly, so the reader still sees where they are. The item isn't expanded by that.

<a id="WORK-00639" data-uid="s81a9n3f9wua"></a>
### R5. Moving to a Section

1. **How:** clicking an item's text, or the empty space right of it, scrolls the file pane to the section, in whichever view is open (Text, Split, Preview or WYSIWYG), as moving to a section from the Comments pane does (Step 012, R6.4). A heading in a document that isn't sectioned is found by its outline path, as a chat citation without a section ID is.
2. **The highlight:** the item clicked becomes the highlighted item (R6), in the navigation color, as the open file is in the folder tree.
3. **Split view:** both sides scroll to the section.
4. **A summarized section** (R7) scrolls to its summary.
5. **Focus:** the keyboard focus stays in the tree, so the reader can move on with the keyboard.

<a id="WORK-00640" data-uid="cwb2soryakjb"></a>
### R6. Following the Document

1. **The highlighted item** is the section whose heading (or list item) is the topmost one visible in the file pane, or, when none is visible, the section the visible text belongs to. Text inside a summary belongs to the summarized section.
2. **When:** as the file pane scrolls by any means (the scroll bar, the wheel, the keyboard, a search, a link), and after moving to a section (R5).
3. **Scrolling the tree:** the highlighted item is scrolled into view in the tree, unless the pointer is over the pane or the focus is in it, as the Comments pane follows the document (Step 012, R7.7).
4. **Split view:** the side scrolled last decides.
5. **After a click:** the clicked item stays highlighted until the file pane is scrolled again, even when the section can't reach the top (the document's last sections).

<a id=""></a>
### R7. The Summary Slider

1. **Only what is shown:** the outline shows only the sections the summary slider leaves visible. A section the slider summarizes stays in the outline, as its summary stays in the preview; the sections inside it are hidden from the outline, as they are from the preview. Moving the slider from level 3 to level 2, for example, summarizes the level-2 sections, so every level-3 item disappears from the outline; moving it back brings them back.
2. **A summarized item** shows that it is summarized: its text is followed by a small "summary" mark, in the muted color, and it has no expander (R4.1), since nothing below it is visible.
3. **The whole document summarized** (the slider's first stop) leaves no item to show: the pane says "The whole document is summarized. Move the summary slider to see its sections."
4. **When it applies:** the slider is part of the Preview and Split views (Client Requirements §6.2). The outline follows it in those views; in the Text and WYSIWYG views, which always show the full text, it shows every section, whatever the slider's position. Switching views changes the outline accordingly.
5. **Collapsed items keep their state:** an item hidden by the slider and shown again is collapsed or expanded as before.
6. **Following the slider:** the outline changes with the slider at once, as the preview does, keeping the highlighted item when it is still shown, or else highlighting the summarized section that holds it.

<a id="WORK-00641" data-uid="s2r8s0qg3jev"></a>
### R8. Performance

1. **Parsing:** the tree is worked out off the main thread, in the preview worker, so typing never waits for it; the main thread's own section lookups parse each body once (see the code review's P2).
2. **Large documents:** typing in a document with 2,000 sections doesn't lag. Parsing such a document (10,000 lines) takes 300 to 600 ms, so its tree appears within about half a second of opening it or of a pause in typing; the 100 ms first asked for isn't reachable with the Markdown parser Specquer uses.

<a id="WORK-00642" data-uid="ukce6unma6rf"></a>
### R9. Other Files and No File

1. **A file other than Markdown** ([Step 014](/work-items/step-014-all-files/requirements)) shows "(Not Markdown)" as plain text in the pane, and no link.
2. **No file open:** "Open a document to see its outline."

<a id="WORK-00643" data-uid="q2t0g2hmitr1"></a>
### R10. Add Section Anchors

1. **The link:** "Add section anchors…" just below the tree, for a Markdown file.
2. **What it does:** the same as **Add section anchors…** in the file's menu in the folder pane (Step 015): it saves the open file, opens the **Add section anchors** dialog for that file, and reloads the file if its anchors changed. For a file outside a sectioned folder, the dialog says that nothing applies (Step 015).
3. **Not shown** for a file other than Markdown, or with no file open.

<a id="WORK-00644" data-uid="dl7t4hca3j0t"></a>
### R11. UI State

1. **The pane:** `sidePane` takes `"outline"` too, and `outlinePaneFraction` holds the pane's width (default 0.3; an invalid value becomes the default).
2. **Collapsed items:** each file's entry in `files` gains `outlineCollapsed`, a list of section UIDs, or of outline paths in a document that isn't sectioned (R4.4), absent when empty. Entries no longer in the document are dropped the next time it is opened. Renaming and deleting a document carry and drop the entry, as they do for the file's other UI state.

<a id="WORK-00645" data-uid="cz7edtnukjob"></a>
### R12. Keyboard

1. **Into the tree:** Tab reaches the tree at its highlighted item, or the first.
2. **Moving:** Up and Down move between visible items; Home and End go to the first and last.
3. **Expanding:** Right expands a collapsed item, or moves to its first child; Left collapses an expanded item, or moves to its parent.
4. **Moving the file pane:** Enter (or Space) moves to the section, as a click on its text does.

<a id="WORK-00646" data-uid="w2chple8prw2"></a>
### R13. Tests

1. **Shared:** the outline tree from a body (headings, setext headings, sectioned list items and their nesting, placeholders, a document that isn't sectioned); the items a slider stop leaves visible, with the summarized ones marked; `sidePane: "outline"`, `outlinePaneFraction` and `outlineCollapsed` in the UI state.
2. **Components:** the three-way toggle; the tree's items, icons and texts, on one line; list items' IDs and first words; expanding and collapsing by the icon, the indentation and the keyboard; a click scrolling the view and highlighting; the highlight following `onTopSection`; the highlight inside a collapsed item; the outline following the slider, and the message for the whole document summarized; "(Not Markdown)"; the link opening the anchor dialog for the file.
3. **End-to-end,** in Chrome and WebKit: open the pane, collapse a section, reload and see it still collapsed; click a section and see the preview scrolled to it; scroll the preview and see the highlight follow; move the slider a level and see the deeper items disappear; open a TypeScript file and see "(Not Markdown)".

<a id="WORK-00647" data-uid="uyt6xc3rlolt"></a>
## 4. Out of Scope

- The badge's menu (copying the ID, **Section attributes…**, **Add comment…**) in the tree, for now.
- Dragging sections in the tree to move them in the document.
- Filtering or searching the tree.
- An outline of files other than Markdown (code symbols).
- Comment counts, or the summaries' text, in the tree.

<a id="WORK-00648" data-uid="yhppwxtq0cym"></a>
## 5. Specifications to Update

- **Client Requirements:** §2 items 3 and 4 (the header and the third pane), §6.2 (the slider also changes the outline), a new section for the outline.
- **Information Architecture:** the screen layout's third pane and the header.
- **Data Architecture:** §3, `sidePane`, `outlinePaneFraction` and `outlineCollapsed`.
- **`CLAUDE.md`:** the new pane's components.

<a id="WORK-00649" data-uid="wp8k87p6hv3j"></a>
## 6. Feedback on the Notes

The points raised on the notes, with where the requirements now settle them:

1. **Documents outside sectioned folders have no sections,** so a tree of sections alone would be empty there, where an outline helps most. Settled: they show their headings (R2.2, R3.2, R4.4).
2. **The badge's menu.** In the tree the notes give the badge another job, expanding and collapsing. Settled: no menu for now (§4).
3. **The item's two click areas** (the icon and the space left of it expand; the text and the space right of it move) are kept as written. A row with no children then has a dead area on its left, which does nothing.
4. **Keyboard.** The notes don't mention it; a tree needs it to be usable without a mouse (R12).
5. **Split view** has two scrolling sides: a click scrolls both, and the highlight follows the side scrolled last (R5.3, R6.4).
6. **The summary slider** hides sections in the preview; the outline now hides them too (R7), so a click never leads to a hidden section.
7. **The root section** is the whole document. It isn't shown as an item, saving a level of indentation (R2.3).
8. **"Add section anchors…"** depends on Step 015's file menu, which adds anchors to a single file. Step 015 is done.
9. **Naming.** Settled: **Outline**, on screen and in code.
10. **The highlight in a collapsed item** isn't covered by the notes (R4.5).
11. **Following after a click.** The last sections of a document can't scroll to the top, so following alone would highlight a section above the one clicked (R6.5).
12. **List items.** Settled: the ID and the first words, on one line (R3.4).
13. **Typo:** "Add section acnhors..." in the notes.

<a id="WORK-00650" data-uid="ynioz5n3nujx"></a>
## 7. Decisions from the First Review

| Topic | Decision | Where |
|---|---|---|
| Documents that aren't sectioned | The tree shows their headings | R2.2, R3.2, R4.4 |
| The badge's menu in the tree | None for now | R3.2, §4 |
| List items | The section ID, the first words and "…", never wrapping to a second line | R3.1, R3.4 |
| Naming | "Outline" on screen and in code (`sidePane: "outline"`, `outlinePaneFraction`, `outlineCollapsed`, the components) | R1, R11 |
| Default for a new document | Fully expanded | R4.3 |
| The summary slider | The outline shows only the sections the slider leaves visible; a slide from level 3 to level 2 hides every level-3 item | R7 |
| The slider in other views | Followed only in the Preview and Split views, which show it; Text and WYSIWYG show every section | R7.4 |

<a id="WORK-00651" data-uid="wea3v5d777mh"></a>
## 8. Risks

1. **Parsing on every keystroke.** Building the tree from the text being edited, on the main thread, repeats the code review's P2. R8 asks for the sections the views already find.
2. **Following in three editors.** The preview, CodeMirror and Milkdown each report their top section differently. Step 012 already built `onTopSection` for all three, for the Comments pane; the outline should share it.
3. **Collapsed state by UID** needs the document saved once with its anchors. Until then, collapsing lasts only while the document is open.
4. **Two kinds of outline in the code.** `shared/src/markdown/outline.ts` already holds the heading outline the summary slider uses (`buildOutline`, outline paths, `summarizedAt`). The new pane's tree should be built on it, since R7 needs the same stops, rather than beside it under a similar name.

<a id="WORK-00652" data-uid="ip4h7fmhbtp5"></a>
## 9. References

- [Step 016 notes](notes.md)
- [Step 015, folder and file menus](/work-items/step-015-folder-menu/task) (Add section anchors for a file)
- [Step 012, comment threads](/work-items/step-012-comment-threads/requirements) (the third pane, following the document, moving to a section)
- [Step 004, hierarchical summarization](/work-items/step-004-hierarchical-summarization/requirements) (the slider's stops)
- [Client Requirements](/specifications/client-requirements), [Data Architecture](/specifications/data-architecture)
- [Code Review, October 2026](/work-items/step-013-code-review/code-review), P2
