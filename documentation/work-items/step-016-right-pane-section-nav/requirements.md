<a id=""></a>

<a id=""></a>
# Step 016 - Table of Contents

_Requirements for a Table of Contents pane: a tree of the open document's sections in the third pane, for moving around the document and seeing where one is. Drafted October 2026 from [the notes](notes.md). The feedback on the notes is in §6, the open questions in §7; the requirements below follow the "Proposed" answers until they are decided._

<a id=""></a>
## 1. Summary

Long specs are hard to move around in: the preview has no outline, and the comment pane's groups only list sections with threads. Step 016 adds a third kind of pane, beside **Chat** and **Comments**:

- **Toggle:** a **Table of Contents** button in the header, left of **Comments**, opens and closes the pane. The three panes take turns: opening one closes the other (R1).
- **The tree:** the open document's sections, nested as in the document, each with its section badge and its heading (R2, R3).
- **Expanding and collapsing:** by the badge or the space left of it, remembered per document (R4).
- **Moving:** clicking a section's text scrolls the file pane to it and highlights it (R5).
- **Following:** as the file pane scrolls, the highlight follows the section at the top (R6).
- **Other files:** a file that isn't Markdown shows "(Not Markdown)" (R8).
- **Add section anchors…:** a link under the tree, as in the file's menu ([Step 015](/work-items/step-015-folder-menu/task)) (R9).

<a id=""></a>
## 2. Precedence

Step 016 takes precedence over the specifications and earlier steps where they conflict:

| Topic | Before | Step 016 (wins) |
|---|---|---|
| The third pane (Client Requirements §2 item 4, Step 012 R1.3) | Chat, comments or nothing: a two-way toggle plus off | Table of contents, comments, chat or nothing: one of three toggles at a time (R1.3) |
| The header (Client Requirements §2 item 3) | **Comments**, **Chat**, gap, theme, **Settings** | **Table of Contents**, **Comments**, **Chat**, gap, theme, **Settings** (R1.1) |
| UI state (Data Architecture §3) | `sidePane: "chat" \| "comments" \| null` | Also `"toc"`; `tocPaneFraction`; per file, the collapsed sections (R10) |

<a id=""></a>
## 3. Requirements

<a id=""></a>
### R1. The Pane and Its Toggle

1. **The button:** a **Table of Contents** toggle in the header, left of the **Comments** toggle, with the same look as the other two: an icon button with `aria-pressed` and the tooltip "Table of contents". Its icon looks like a table of contents: lines of text with indented lines below them (Lucide's `TableOfContents`).
2. **The pane:** the table of contents opens in the third pane's place, right of the file pane, with a drag bar between them, as the chat and the comments do.
3. **One at a time:** the three toggles work as one switch. Opening the table of contents closes the chat or the comments, and opening either of them closes the table of contents. Pressing the open pane's toggle closes it.
4. **Width:** the pane has its own width, a fraction of the window from 0.15 to 0.5, by default 0.3, with the file pane keeping at least 30% of the window, as for the other two panes.
5. **Kept:** which pane is open, and the table of contents' width, are kept in `uistate.yaml` (R10).

<a id=""></a>
### R2. The Tree

1. **What it shows:** the sections of the document open in the file pane, as the text being edited holds them, nested as in the document: a heading's section holds the headings below it of a deeper level, and the list items sectioned within it; a sectioned list item holds its sectioned nested items.
2. **The root:** the document's root section isn't an item of its own; its sections are the tree's top level. The file name is already in the path above the file pane (feedback 7).
3. **Order:** document order, as the sections appear.
4. **Updates:** the tree follows edits in the text, Split and WYSIWYG views, at most a quarter of a second after typing stops, keeping what is expanded, collapsed and highlighted. A section added appears; one deleted disappears.
5. **Empty:** a Markdown document without sections says so: "This document has no sections yet." (and see feedback 1 for documents outside sectioned folders).
6. **Accessibility:** the tree is a `tree` with `treeitem`s and `group`s, named "Table of contents", with the keyboard of a tree view (R11).

<a id=""></a>
### R3. The Items

1. **An item** is one row: the section's badge, then its text.
2. **The badge** is the section badge of the preview and WYSIWYG views (the § icon, with its status and problem marks as there). In the tree it doesn't open the badge's menu; it expands and collapses (R4).
3. **The text** of a heading's section is its heading, as plain text without Markdown markup. A long heading is cut with "…" to the pane's width, the full heading in its tooltip.
4. **A list item's section** shows its section ID (feedback 12): `REQ-00042`, with the item's first words in its tooltip.
5. **A section not saved yet** (a placeholder `<a id="">`, or a heading written since the last save) appears with its heading and without a badge until a save gives it its ID.

<a id=""></a>
### R4. Expanding and Collapsing

1. **Which items:** only items with sections below them can be expanded; the others have no expander.
2. **How:** clicking an item's badge, or the empty space left of it (its indentation), expands it if collapsed and collapses it if expanded. The keyboard does the same (R11).
3. **The default:** a document opened for the first time shows every item expanded.
4. **Kept per document:** the items collapsed are kept in `uistate.yaml` per document, by section UID, so they stay collapsed after edits that move them, after a reload and after a restart. Sections without a UID yet can be collapsed for as long as the document stays open (R10.2).
5. **Highlighted inside a collapsed item:** when the highlighted section (R5, R6) is inside a collapsed item, the collapsed item shows as highlighted, more faintly, so the reader still sees where they are. The item isn't expanded by that.

<a id=""></a>
### R5. Moving to a Section

1. **How:** clicking an item's text, or the empty space right of it, scrolls the file pane to the section, in whichever view is open (Text, Split, Preview or WYSIWYG), as moving to a section from the Comments pane does (Step 012, R6.4).
2. **The highlight:** the item clicked becomes the highlighted item (R6), in the navigation color, as the open file is in the folder tree.
3. **Split view:** both sides scroll to the section.
4. **Summaries:** when the summary slider hides the section in Preview or Split, the slider moves to the full text first, as opening a chat citation does (Client Requirements §11 item 6) (feedback 6).
5. **Focus:** the keyboard focus stays in the tree, so the reader can move on with the keyboard.

<a id=""></a>
### R6. Following the Document

1. **The highlighted item** is the section whose heading (or list item) is the topmost one visible in the file pane, or, when none is visible, the section the visible text belongs to.
2. **When:** as the file pane scrolls by any means (the scroll bar, the wheel, the keyboard, a search, a link), and after moving to a section (R5).
3. **Scrolling the tree:** the highlighted item is scrolled into view in the tree, unless the pointer is over the pane or the focus is in it, as the Comments pane follows the document (Step 012, R7.7).
4. **Split view:** the side scrolled last decides (feedback 5).
5. **After a click:** the clicked item stays highlighted until the file pane is scrolled again, even when the section can't reach the top (the document's last sections).

<a id=""></a>
### R7. Performance

1. **Parsing:** the tree is built from the sections the views already find (the preview's worker, or the section analysis the comment highlights use), not from a parse of its own on every keystroke (see the code review's P2).
2. **Large documents:** a document with 2,000 sections opens its tree in under 100 ms, and typing in it doesn't lag.

<a id=""></a>
### R8. Other Files and No File

1. **A file other than Markdown** ([Step 014](/work-items/step-014-all-files/requirements)) shows "(Not Markdown)" as plain text in the pane, and no link.
2. **No file open:** "Open a document to see its table of contents."
3. **A Markdown file outside a sectioned folder:** see feedback 1.

<a id=""></a>
### R9. Add Section Anchors

1. **The link:** "Add section anchors…" just below the tree, for a Markdown file.
2. **What it does:** the same as **Add section anchors…** in the file's menu in the folder pane (Step 015): it saves the open file, opens the **Add section anchors** dialog for that file, and reloads the file if its anchors changed. For a file outside a sectioned folder, the dialog says that nothing applies (Step 015).
3. **Not shown** for a file other than Markdown, or with no file open.

<a id=""></a>
### R10. UI State

1. **The pane:** `sidePane` takes `"toc"` too, and `tocPaneFraction` holds the pane's width (default 0.3; an invalid value becomes the default).
2. **Collapsed sections:** each file's entry in `files` gains `tocCollapsed`, a list of section UIDs, absent when empty. UIDs no longer in the document are dropped the next time it is opened. Renaming and deleting a document carry and drop the entry, as they do for the file's other UI state.

<a id=""></a>
### R11. Keyboard

1. **Into the tree:** Tab reaches the tree at its highlighted item, or the first.
2. **Moving:** Up and Down move between visible items; Home and End go to the first and last.
3. **Expanding:** Right expands a collapsed item, or moves to its first child; Left collapses an expanded item, or moves to its parent.
4. **Moving the file pane:** Enter (or Space) moves to the section, as a click on its text does.

<a id=""></a>
### R12. Tests

1. **Shared:** the section tree from a body (headings, setext headings, sectioned list items and their nesting, placeholders); `sidePane: "toc"`, `tocPaneFraction` and `tocCollapsed` in the UI state.
2. **Components:** the three-way toggle; the tree's items, badges and texts; expanding and collapsing by the badge, the indentation and the keyboard; a click scrolling the view and highlighting; the highlight following `onTopSection`; the highlight inside a collapsed item; "(Not Markdown)"; the link opening the anchor dialog for the file.
3. **End-to-end,** in Chrome and WebKit: open the pane, collapse a section, reload and see it still collapsed; click a section and see the preview scrolled to it; scroll the preview and see the highlight follow; open a TypeScript file and see "(Not Markdown)".

<a id=""></a>
## 4. Out of Scope

- The badge's menu (copying the ID, **Section attributes…**, **Add comment…**) in the tree; see feedback 2.
- Dragging sections in the tree to move them in the document.
- Filtering or searching the tree.
- A table of contents for files other than Markdown (code symbols).
- Comment counts or summaries in the tree.

<a id=""></a>
## 5. Specifications to Update

- **Client Requirements:** §2 items 3 and 4 (the header and the third pane), a new section for the table of contents.
- **Information Architecture:** the screen layout's third pane and the header.
- **Data Architecture:** §3, `sidePane`, `tocPaneFraction` and `tocCollapsed`.
- **`CLAUDE.md`:** the new pane's components.

<a id=""></a>
## 6. Feedback on the Notes

Each point says what the requirements above assume (_Proposed_), until it is decided.

1. **Documents outside sectioned folders have no sections.** Sections, and their badges, exist only where Specquer adds anchors. In this repository, `documentation/notes/` is sectioned, but a README or a folder left non-sectioned would show an empty tree, which makes the pane useless exactly where an outline helps most. _Proposed:_ in a document that isn't sectioned, the tree shows its headings, with a plain heading icon instead of a badge, and no list items. Expanding, moving, following and keeping collapsed headings work the same, keyed by heading position instead of UID.
2. **The badge's menu.** In the preview and WYSIWYG views, clicking a badge opens its menu (copy the ID, **Section attributes…**, **Add comment…**, renumbering). In the tree the notes give the badge another job, expanding and collapsing. _Proposed:_ the tree's badge only expands and collapses; right-clicking an item could open the badge's menu later (§4).
3. **The item's two click areas** (the badge and the space left of it expand; the text and the space right of it move) are kept as written. A row with no children then has a dead area on its left, which does nothing.
4. **Keyboard.** The notes don't mention it; a tree needs it to be usable without a mouse (R11).
5. **Split view** has two scrolling sides. _Proposed:_ a click scrolls both; the highlight follows whichever side was scrolled last.
6. **Summaries.** A section hidden under a summary can't be scrolled to. _Proposed:_ the slider moves to the full text, as for chat citations.
7. **The root section** is the whole document. _Proposed:_ it isn't shown as an item, saving a level of indentation; the file name is in the path above the file pane.
8. **"Add section anchors…"** depends on Step 015's file menu, which adds anchors to a single file. Step 016 should follow Step 015.
9. **Naming.** "Table of Contents" for the button and the pane, as in the notes; "Outline" would be shorter and is the word the summary slider's code uses. Either works.
10. **The highlight in a collapsed item** isn't covered by the notes. _Proposed:_ R4.5.
11. **Following after a click.** The last sections of a document can't scroll to the top, so following alone would highlight a section above the one clicked. _Proposed:_ R6.5.
12. **List items as their ID.** An ID alone (`REQ-00042`) says little in a long list. _Proposed:_ as the notes say, with the item's first words in the tooltip; the first words could be shown after the ID instead (question 3).
13. **Typo:** "Add section acnhors..." in the notes.

<a id=""></a>
## 7. Open Questions

1. **Documents that aren't sectioned:** show their headings (feedback 1), or an empty tree with a hint to make the folder sectioned?
2. **The badge's menu** in the tree: never, or on right-click (feedback 2)?
3. **List items:** the ID alone, or the ID followed by the item's first words?
4. **Naming:** "Table of Contents" or "Outline" (feedback 9)?
5. **Default for a new document:** everything expanded (R4.3), or only the top level?

<a id=""></a>
## 8. Risks

1. **Parsing on every keystroke.** Building the tree from the text being edited, on the main thread, repeats the code review's P2. R7 asks for the sections the views already find.
2. **Following in three editors.** The preview, CodeMirror and Milkdown each report their top section differently. Step 012 already built `onTopSection` for all three, for the Comments pane; the table of contents should share it.
3. **Collapsed state by UID** needs the document saved once with its anchors. Until then, collapsing lasts only while the document is open.

<a id=""></a>
## 9. References

- [Step 016 notes](notes.md)
- [Step 015, folder and file menus](/work-items/step-015-folder-menu/task) (Add section anchors for a file)
- [Step 012, comment threads](/work-items/step-012-comment-threads/requirements) (the third pane, following the document, moving to a section)
- [Client Requirements](/specifications/client-requirements), [Data Architecture](/specifications/data-architecture)
- [Code Review, October 2026](/work-items/step-013-code-review/code-review), P2
