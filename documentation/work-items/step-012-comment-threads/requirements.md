<a id="WORK-00485" data-uid="iemnotj3mhqx"></a>

<a id="WORK-00486" data-uid="l0zeqoo9kfrg"></a>
# Step 012 - Comment Threads

_Requirements for threaded comments on sections, kept in a sidecar file beside each document, shown as markers on the section badges and read and written in a new Comments pane. Drafted October 2026._

<a id="WORK-00496" data-uid="gia0haa8um3j"></a>
## 1. Summary

Specs are reviewed by people, but nothing yet lets them discuss a section where it lives. Step 012 adds comment threads:

- **Top bar and pane:** a Comments icon opens a Comments pane in the third pane's place; it and AI Chat share that place, so the two icons work as a three-way toggle (R1).
- **Threads:** a thread belongs to one section, by its UID, and holds Markdown comments; it is Open or Resolved, and read-only while Resolved. Anyone can add, edit or delete comments and threads, and each comment records who wrote it and who last changed it (R2).
- **Saving:** a comment is saved when its editor loses focus or its Save button is pressed (R2.6).
- **Storage:** threads are kept in a sidecar file, `<name>.md.comments.yaml`, next to the document, which Specquer renames and deletes with it, and agents are told to do the same (R3).
- **Markers:** a section with threads that the status filter shows has a comment pip beside its badge (a gutter marker in the plain text view), whether the pane is open or not (R5).
- **Highlighting:** hovering or focusing a thread highlights its section, and hovering a pip highlights its threads (R6).
- **Pane:** threads are grouped by section in document order, follow the document as it scrolls, and are filtered by status (R7).
- **Keyboard:** F8 and Shift+F8 move to the next and previous thread (R8).
- **Saving the document:** the open document is also saved when the window loses focus, so switching to another application saves it as a comment is saved (R9).
- **Problems:** an unusable sidecar, a sidecar without its document and a thread whose section is gone are section problems (R4).

<a id="WORK-00497" data-uid="jb725c4t7w1o"></a>
## 2. Precedence

Step 012 takes precedence over the specifications and earlier steps where they conflict:

| Topic | Before | Step 012 (wins) |
|---|---|---|
| The third pane | AI Chat or nothing (`chatOpen` in `uistate.yaml`) | AI Chat, Comments or nothing, each with its own width (R1.3, R1.4) |
| The AI Chat icon | Speech bubble, tail on the left | Mirrored, tail on the right, with a small four-point star inside (R1.1) |
| The section badge's menu | **Copy this section ID**, **Section attributes…** | Also **Add comment…** and **Show comments** (R5.5) |
| Files beside a document | None | `<name>.md.comments.yaml` (R3) |
| Renaming and deleting a document | The document only | Its sidecar too (R3.5) |
| Rules for agents (`AGENTS.md`, `CLAUDE.md`) | Section anchor rules | Also: move, rename or delete a document's sidecar with it (R3.7) |
| Autosave of the open document (Client Requirements §7 item 1) | Before another file opens, when the tab is hidden or the page closes, and every 60 seconds | Also when the window loses focus, with the WYSIWYG view's latest edits included (R9) |
| Section problems | … and unusable `prefix.config.yaml` files | Also unusable and orphaned sidecars, and detached threads (R4) |

<a id="WORK-00498" data-uid="g7qgvxzwu9bb"></a>
## 3. Requirements

<a id="WORK-00487" data-uid="wyrvj9kz262k"></a>
### R1. Top Bar and the Third Pane

1. **AI Chat icon:** mirrored horizontally, so its tail is on the right, with a small four-point AI star inside the bubble. The space between it and the light/dark toggle is doubled.
2. **Comments icon:** a new icon left of the AI Chat icon: a hollow speech bubble with its tail down and to the left, like Font Awesome's regular "comment" icon.
3. **Three-way toggle:** the third pane of the layout shows AI Chat, Comments or nothing. Clicking an icon opens its pane, closing the other one if it is open; clicking the icon of the open pane closes it. Each icon shows whether its pane is open.
4. **UI state:** `uistate.yaml` keeps which pane is open (`chat`, `comments` or none) in place of `chatOpen`, the Comments pane's own width beside `chatPaneFraction`, and the status filter (R7.5). A `uistate.yaml` with `chatOpen: true` opens AI Chat.

<a id="WORK-00488" data-uid="wh27872709l9"></a>
### R2. Threads and Comments

1. **Threads:** a thread is a conversation about one section, identified by the section's UID (`data-uid`). A section may have any number of threads. Threads point to whole sections only, never to a passage within one.
2. **Status:** a thread is **Open** or **Resolved**. A new thread is Open. Anyone can resolve or reopen a thread. A Resolved thread is read-only: it can't be replied to and its comments can't be edited or deleted until someone clicks **Reopen**, though it can still be deleted as a whole. Each change of status records who made it and when (R3.2), and the pane shows the latest ("Resolved by Martin Nordberg, 14 Oct 2026").
3. **Comments:** a thread holds one or more comments in the order written; the first starts the thread, the others are replies. Each comment has its text, in Markdown, and who created it and when; once edited, also who last changed it and when (R3.2). Times are stored in UTC and shown in the browser's locale; an edited comment shows that it was edited, by whom and when.
4. **The user:** the name recorded for the user is their Git identity (`user.name`, or else `user.email`) in the root folder's repository, or else the operating system's login name.
5. **Editor:** comments are written and edited in a WYSIWYG Milkdown editor. A new thread or reply opens in the editor at once; a saved comment is edited only after clicking its **Edit** button.
6. **Saving:** a comment is saved to the sidecar when its editor loses focus, for any reason: clicking elsewhere, switching documents, closing the pane, or the window losing focus (switching to a Git client, for instance). A Save button under the editor saves the comment and closes the editor, for users who look for one; it is never needed. A comment whose text hasn't changed isn't written again, and its `updatedBy` and `updatedAt` stay as they were. A new comment left empty isn't saved.
7. **Abandoning an edit:** Escape leaves the editor without saving: a saved comment gets its text back, and a new one is discarded. A saved comment whose text is cleared and then left also gets its text back; deleting is always an explicit **Delete**.
8. **Anyone can edit:** any user can edit or delete any comment; there is no ownership. `updatedBy` records who changed it last.
9. **Deleting:** a reply can be deleted on its own, without confirmation. A thread's first comment can be deleted only while the thread has no replies, and deleting it deletes the thread. **Delete thread** deletes a thread with all its comments, after confirmation.
10. **Markdown:** comments are rendered without raw HTML, and images and links of every kind (inline, reference, autolinks and bare URLs) are never rendered as HTML. A link shows as its text followed by its URL, and an image as its alt text followed by its URL, both as plain text that can be copied. The comment editor has Milkdown's link and image handling turned off, so a pasted URL stays plain text.
11. **Which sections:** any section that has a UID, in a `BASELINE`, `CHANGE` or `AUXILIARY` folder, can have threads, including a document's root section and list-item sections. Files in `NONSECTIONED` folders have none. A section that has no UID yet (a new `<a id="">` not yet saved) can't: **Add comment…** is disabled, saying the file must be saved first.

<a id="WORK-00489" data-uid="stks3gc0z4s0"></a>
### R3. The Comment Sidecar File

1. **Name and place:** a document's threads are kept in a sidecar file next to it, named after the document with `.md` replaced by `.md.comments.yaml` (`requirements.md` → `requirements.md.comments.yaml`). It is shared (committed with the document).
2. **Format:** a YAML list of threads under `threads`. `threadUid` and `commentUid` are issued by Specquer in the same form as section UIDs. `updatedBy` and `updatedAt` appear only once a comment has been edited, and `statusChangedBy` and `statusChangedAt` only once a thread's status has changed.
   ```yaml
   threads:
     - threadUid: q7d2kx9m0w4a
       sectionUid: abcdef123456
       status: Open
       comments:
         - commentUid: r3n8vb1z6p0c
           createdBy: Martin Nordberg
           createdAt: '2026-10-10T12:22:59Z'
           text: "Initial comment."
         - commentUid: h5t0yq2e7j9s
           createdBy: Wilbur Smith
           createdAt: '2026-10-14T18:00:00Z'
           updatedBy: Martin Nordberg
           updatedAt: '2026-10-14T19:05:12Z'
           text: "A reply, since edited."
     - threadUid: m1w6fc8u3k5d
       sectionUid: abcdef123456
       status: Resolved
       statusChangedBy: Wilbur Smith
       statusChangedAt: '2026-10-13T08:15:40Z'
       comments:
         - commentUid: x2g9ra4l7n1e
           createdBy: Martin Nordberg
           createdAt: '2026-10-12T09:33:59Z'
           text: "A resolved comment thread for the same section."
     - threadUid: b8z3pd0s5v2h
       sectionUid: abcdef987654
       status: Open
       comments:
         - commentUid: t6c1kw9o4y8f
           createdBy: Martin Nordberg
           createdAt: '2026-10-13T11:11:59Z'
           text: "Comment for a different section."
   ```
3. **Reading and writing:** the server reads and writes sidecars with the `yaml` package and reads one again when it changes on disk. Each change (add, edit or delete a comment; add, resolve, reopen or delete a thread) is applied by its UIDs to the file as it is on disk, so a change on disk to other threads or comments (a Git pull, for instance) is kept. A change to a comment that was itself changed on disk since it was loaded is refused: the unsaved text is lost, the pane says so and shows the comment as it is now. This is unlikely, since leaving Specquer for a Git client saves the comment first (R2.6).
4. **Created and deleted on demand:** a document has no sidecar until its first thread is added, and the sidecar is deleted when its last thread is.
5. **With its document:** renaming or deleting a document in Specquer renames or deletes its sidecar too, and the delete dialog lists the sidecar. Renaming or deleting a folder carries its sidecars with it. The file tree doesn't show sidecars.
6. **New and copied documents:** a new document starts with no threads, and so does a copy, since Specquer never copies a sidecar. Creating a document, or renaming one, onto a name whose orphaned sidecar (R4.2) is still there deletes the leftover sidecar first.
7. **Agents:** the agent rules (`shared/src/sections/agent-guide.ts`, written to `AGENTS.md`, and the same rules in `CLAUDE.md`) gain a rule: when moving, renaming or deleting a document, move, rename or delete its `.md.comments.yaml` with it. Agents otherwise leave sidecars alone (§4).

<a id="WORK-00499" data-uid="ho6ossa45cqe"></a>
### R4. Section Problems

1. **Unusable sidecar:** a sidecar that isn't valid YAML, doesn't match the format (R3.2), has an unknown status, repeats a `threadUid` or `commentUid`, or holds conflict markers is a section problem. Its threads aren't shown, and Specquer doesn't write it until it is fixed.
2. **Orphaned sidecar:** a sidecar with no document beside it (left behind when a document was moved or renamed outside Specquer) is a section problem.
3. **Detached thread:** a thread whose `sectionUid` isn't a section of the saved document is a section problem. It is shown in the pane's **Detached** group (R7.6).

<a id="WORK-00492" data-uid="w1kjbl05n88w"></a>
### R5. Comment Pips

1. **Where:** a section with at least one thread that the status filter (R7.5) shows has a comment pip beside its badge in the preview and WYSIWYG views, including list-item sections, and a gutter marker on its anchor's line in the plain text view (the plain text view's pip). Other sections show nothing. Pips show whether the Comments pane is open or closed.
2. **Count:** the pip shows the number of the section's own threads that the filter shows. A subsection's threads are never counted on its parent's pip, except under the summary slider (R5.6).
3. **Popover:** hovering or focusing the pip shows the first line of each of those threads.
4. **Opening:** clicking the pip (or Enter or Space on it) opens the Comments pane, closing AI Chat, and scrolls it to the section's group.
5. **Badge menu:** the section badge's menu gains **Add comment…**, which opens the Comments pane with a new thread on the section (R7.4), and **Show comments**, which does what clicking the pip does.
6. **Summary slider:** while the summary slider hides sections, the shown threads of hidden sections are counted on the pip of their nearest visible ancestor, marked as being in hidden sections ("3 (2 hidden)").
7. **Unsaved edits:** a pip is attached to its section's anchor, so it moves with the anchor as the document is edited and disappears when the anchor is deleted, before the file is saved.
8. **Accessibility:** a pip is focusable and has an accessible name that includes the filter ("2 open comment threads", "1 resolved comment thread", "3 comment threads").

<a id="WORK-00500" data-uid="lw752h8eptdg"></a>
### R6. Linked Highlighting

1. **Thread to section:** hovering or focusing a thread, or a section group's header, in the Comments pane highlights the section's extent in the document: from its anchor to the end of the section, subsections included. For a list-item section, the extent is the item with its nested items.
2. **Section to threads:** hovering or focusing a pip highlights the section's threads in the Comments pane, when it is open.
3. **How:** the highlight is a background tint only. In the plain text and WYSIWYG views it is a decoration that never changes the text; in the preview it is a class on the section's elements.
4. **Flash:** moving to a section from the pane (R7.2) or with the keyboard (R8) flashes its extent briefly. With reduced motion preferred, the tint shows without animation.

<a id="WORK-00493" data-uid="ghst0sg7mr4n"></a>
### R7. The Comments Pane

1. **Scope:** the pane shows the threads of the open document only. With no document open, or one that can't have threads (R2.11), it says so.
2. **Groups:** threads are grouped by section, in document order, and only sections with threads the filter shows have a group. A group's header shows the section ID, its heading text and its status; clicking it scrolls the document to the section and flashes it (R6.4).
3. **Threads:** each thread starts collapsed, showing its first comment, its number of replies and its status. Expanded, it shows the whole conversation and, while Open, an editor for a reply and **Resolve**; while Resolved, only **Reopen** (R2.2). Each comment has **Edit** and, where allowed (R2.9), **Delete**; the thread has **Delete thread**, which asks for confirmation.
4. **New threads:** each group's header has **+ New thread**. Starting a new thread, from there or from the badge menu (R5.5), collapses the section's other threads.
5. **Filter:** **Open**, **Resolved** or **All**, Open by default and kept in UI state. It decides which threads the pane, the pips (R5) and F8 (R8) show. When it hides threads, the pane says how many.
6. **Detached:** detached threads (R4.3) are listed last, in a **Detached** group. They can be read, resolved, reopened and deleted, but not replied to, edited or moved to another section.
7. **Following the document:** as the document scrolls, the pane scrolls to keep the group of the topmost visible section that has threads in view. The document only moves when the pane asks it to (R7.2, R8).

<a id="WORK-00501" data-uid="uxa7en1n887s"></a>
### R8. Moving Between Threads

1. **F8 and Shift+F8:** move to the next and previous thread the filter shows, in document order, across the whole document, from any view or the pane. Each scrolls the document and the pane, flashes the section (R6.4) and focuses the thread in the pane, opening the pane if it is closed.

<a id="WORK-00533" data-uid="jguchtugoh7o"></a>
### R9. Saving the Document When Leaving the Window

Comments are saved when their editor loses focus (R2.6); the document should be saved as reliably, so a user who switches to a Git client sees both. Today the document is saved when the tab is hidden (`visibilitychange`), when the page closes (`pagehide`), before another file opens and every 60 seconds (`client/src/app/App.tsx`). Two gaps remain:

- Switching to another application usually doesn't hide the tab: Alt+Tab leaves the page visible unless the browser window is minimized or fully covered, and on Linux the browser hardly ever reports it as hidden. Nothing is saved until the 60-second timer. (Seen in the plain text view: "Unsaved changes" stays after Alt+Tab away and back.)
- The WYSIWYG view reports edits to the document store through Milkdown's listener, which waits 200 ms after the last change. Edits made in the last 200 ms before the tab is hidden or the page closes aren't in the store yet, so that save misses them.

1. **Window focus:** the open document is saved when the browser window loses focus (`blur` on `window`), as well as when the tab is hidden or the page closes. Saving while the window still shows a visible page doesn't need `keepalive`.
2. **Latest edits:** before any save (window focus, hidden tab, page close, opening another file, the timer, **Unsaved changes**, or sending a chat question), the WYSIWYG view's pending edits are handed to the document store at once, so the save holds everything typed.
3. **Once each:** a single switch away that raises both `blur` and `visibilitychange` writes at most once, since a file is only written when its text differs from what was last saved (Client Requirements §7 item 2) and saves are queued.
4. **Conflicts:** a save on leaving the window follows the same rules as autosave: if the file changed on disk, the conflict dialog is shown when the user returns.

<a id="WORK-00502" data-uid="e6ggo7zf3nf4"></a>
### R10. Tests

1. **Unit (`shared`):** the sidecar schema; the section extent used for highlighting, for headings, setext headings, list items and the root section; comment Markdown rendering with raw HTML, and images and every kind of link shown as plain text with their URLs.
2. **Unit (`server`):** reading and re-reading sidecars; each change applied by UIDs to a file changed on disk, and the refusal when the same comment changed; recording status changes; refusing changes to the comments of a Resolved thread; refusing to delete a first comment that has replies; creating and deleting the sidecar with the first and last thread; renaming and deleting it with its document; deleting a leftover sidecar when a document is created or renamed onto its name; each kind of unusable sidecar, orphaned sidecars and detached threads as problems; the user's name from Git config and from the login name.
3. **Components:** the three-way toggle and its UI state; pips and their counts under each filter, popover, menu items and roll-up under the summary slider; the pane's groups, filter, collapse, new-thread, edit and delete behavior; a Resolved thread offering only **Reopen** and **Delete thread**; what a detached thread allows; saving on loss of focus, Escape, and a cleared comment getting its text back; **Edit**; confirming **Delete thread**; linked highlighting both ways; F8 and Shift+F8; saving the document on window `blur`, and a WYSIWYG edit typed just before the tab is hidden being included in the save.
4. **End to end:** add a thread from the badge menu, reply, edit the reply, resolve the thread, reload and see it in the sidecar and the pane; rename the document and see the sidecar follow; edit the document, take focus away from the window and see the file saved; delete the section, save and see the thread in **Detached** and in **Section problems…**.

<a id="WORK-00503" data-uid="ecvso74955w3"></a>
## 4. Out of Scope

- Threads on passages within a section (text-range anchoring).
- Threads shown inline in the document ("peek"), and a pager between threads.
- Margin bars, a colored rule beside highlighted sections, and marks on the scrollbar.
- One dot per thread on the pip.
- Comment counts in the file tree.
- Threads of other documents: a review inbox for the whole root folder.
- Filtering by section or by author.
- Ownership of comments and authentication: anyone can edit anything, and names are whatever Git says.
- Threads in `NONSECTIONED` folders.
- Agents reading or replying to threads (beyond moving sidecars with their documents, R3.7), and comments in the chat's search index.
- Moving a detached thread to another section.
- Notifications and mentions.

<a id="WORK-00504" data-uid="sbe6n7thcmev"></a>
## 5. Specifications to Update

- **[Client Requirements](/specifications/client-requirements):** the top bar's icons, the third pane, the badge menu, pips, highlighting, the Comments pane and F8; §7 item 1, saving when the window loses focus (R9).
- **[Data Architecture](/specifications/data-architecture):** the sidecar file and its problems; the open pane, the Comments pane's width and the filter in UI state.
- **[Information Architecture](/specifications/info-architecture):** sidecars in the folder diagram.
- **[Server Requirements](/specifications/server-requirements):** the comments API, the user's name, and renaming and deleting sidecars with documents.
- **[Security](/specifications/security):** comment Markdown rendered without raw HTML, images or links; names as a label, not an identity.
- **`CLAUDE.md`:** the sidecar files and the comments modules, and the sidecar rule for agents (R3.7).

<a id="WORK-00505" data-uid="ykpaf28k3d98"></a>
## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Two people change the same sidecar on different branches | A Git merge conflict in YAML | Conflict markers make it a section problem (R4.1), and Specquer won't write it until resolved |
| A section is deleted or its anchor lost | Its threads lose their place | They are listed as **Detached** and as problems (R4.3), never dropped |
| A document is moved or renamed outside Specquer (`git mv`, the file manager) | Its sidecar is left behind | It is reported as orphaned (R4.2); the agent rule covers agents (R3.7) |
| Saving on loss of focus | A stray click saves a half-written comment | Escape abandons an edit (R2.7); comments can be edited and deleted by anyone (R2.8, R2.9) |
| Deleting a leftover sidecar (R3.6) | Its threads are lost from the working tree | It was reported as orphaned (R4.2) before, and Git history keeps it |
| A refused save (R3.3) | The user's unsaved text is lost | Unlikely, since leaving the window saves first; the pane says what happened |
| No ownership | Anyone can change or delete anyone's comment | `updatedBy` shows who changed a comment last, and Git history keeps the rest |
| Pips in WYSIWYG node views | The badges redraw as threads change | The pip's count comes from the threads, not the document, so text edits don't redraw it |

<a id="WORK-00491" data-uid="ki3skgvt2kbx"></a>
## 7. Open Questions

None. All were decided while reviewing the requirements: the sidecar's fields (R3.2); whole sections only (R2.1); highlighting subsections (R6.1); no roll-up on pips except under the summary slider (R5.2, R5.6); no file tree counts (§4); the open document only (R7.1); pips only, following the filter (R5.1, R5.2); list items (R5.1); starting threads from the badge and the pane (R5.5, R7.4); unsaved edits (R5.7); F8 and Shift+F8 (R8); the sidecar with its document, new and copied documents, and leftover sidecars (R3.5, R3.6); the agent rule (R3.7); no ownership (R2.8); saving on loss of focus, **Edit**, Escape and cleared comments (R2.5–R2.7); deleting and confirming (R2.9); Resolved threads read-only (R2.2); refused saves (R3.3); images and links as plain text (R2.10); detached threads (R7.6); widths and filter in UI state (R1.4); no chat search (§4); no `NONSECTIONED` threads (R2.11).

<a id="WORK-00490" data-uid="fhywxavlgwr6"></a>
## 8. References

* [MRSF v1.0](https://github.com/wictorwilen/MRSF/blob/main/MRSF-v1.0.md) - a similar idea: Markdown review comments in a sidecar file.
