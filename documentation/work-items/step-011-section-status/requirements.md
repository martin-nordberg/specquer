<a id="WORK-00437" data-uid="pjk0ec75ooxg"></a>

<a id="WORK-00438" data-uid="rcylm8zkb308"></a>
# Step 011 - Section Status

_Requirements for giving each section a status (Draft, Approved, In Development and so on), kept in its section anchor, inherited from its parent section when it has none, and changed from the section badge. Drafted October 2026._

<a id="WORK-00445" data-uid="ghed0rajtef5"></a>
## 1. Summary

Sections have permanent IDs, but nothing yet says how far along a section is. Step 011 gives each section a status:

- **Storage:** the status is a `data-status` attribute on the section anchor, so it lives in the Markdown and travels with the section (R1).
- **Allowed values:** each prefix has its own list of statuses, hand-edited in `.specquer/shared/<prefix>/prefix.config.yaml`, with a default list when there is no file or it can't be used (R2).
- **Inheritance:** a section with no status of its own takes its parent section's, within the same prefix (R3).
- **Badge:** the badge's tooltip shows the status. Right-clicking the badge opens a menu with **Copy this section ID** and **Section attributes…**; left-clicking the badge no longer copies the ID (R4).
- **Dialog:** **Section attributes…** changes the status in the editor's buffer, as an ordinary unsaved edit (R5).
- **Problems:** a status that isn't allowed, and a `prefix.config.yaml` that can't be used, are new kinds of section problem (R6).
- **Agents:** the section anchor rules for agents say when they may change a status (R1.9).

<a id="WORK-00446" data-uid="o2n5tvpxj4fl"></a>
## 2. Precedence

Step 011 takes precedence over the specifications and earlier steps where they conflict:

| Topic | Before | Step 011 (wins) |
|---|---|---|
| Section anchor attributes | `id` and `data-uid` | Also `data-status`, optional (R1) |
| Clicking a section badge | Copies the section ID (Client Requirements §6.1 item 2) | Does nothing; right-clicking opens a menu that can copy the ID (R4) |
| Badge tooltip | Section ID, document path, UID | The ID is followed by the effective status: "SPEC-00012 - Draft" (R4) |
| Badge warning ring | An ID used more than once | Also an invalid status (R4.1) |
| Files in `.specquer/shared/<prefix>/` | `sections.yaml`, written by Specquer | Also `prefix.config.yaml`, hand-edited (R2) |
| Section problems | Nested Specquer folders, copied documents, duplicate and colliding IDs, stray anchors, conflict markers | Also statuses that aren't allowed and unusable `prefix.config.yaml` files (R6) |
| Edits a save makes to anchors | IDs and UIDs added or corrected | Also a status's capitalization and surrounding spaces corrected (R1.5) |
| Section anchor rules for agents (`AGENTS.md`, `CLAUDE.md`) | Never edit `id` or `data-uid` | Also: change `data-status` only when asked, and only to an allowed value (R1.9) |

<a id="WORK-00447" data-uid="epfyj15703mm"></a>
## 3. Requirements

<a id="WORK-00448" data-uid="sldvt08dvraf"></a>
### R1. Status in the Section Anchor

1. **Attribute:** a section's own status is the `data-status` attribute of its section anchor:
   `<a id="REQ-12345" data-uid="abcdefghijkl" data-status="Peer Review"></a>`.
2. **Optional:** a section anchor without `data-status` has no status of its own, and its effective status is inherited (R3).
3. **Folder types:** status applies to sections in `BASELINE`, `CHANGE` and `AUXILIARY` folders. `NONSECTIONED` folders have no sections, so they have no statuses.
4. **Valid values:** a status is valid when it matches one of the allowed values for the section's prefix (R2), ignoring case and spaces at its start and end. A blank value (`data-status=""` or only spaces) is invalid.
5. **Capitalization and spaces:** a status that matches an allowed value in all but case and surrounding spaces (`peer review`, `" Draft "`) is valid. When the file is next saved, Specquer corrects it to the allowed value as written in the list (`Peer Review`, `Draft`). Like the anchors a save adds, the correction is applied to the editor at once and doesn't count as an unsaved change (Client Requirements §7 item 4). Scans never write, so a file that isn't saved keeps its spelling.
6. **IDs and UIDs:** adding or correcting a section's `id` or `data-uid` (on save, on **Renumber**, or when an `XYZ-?` placeholder changes the section's prefix) never changes its `data-status`. If the status isn't valid afterwards, for example because the new prefix doesn't allow it, that is a section problem (R6), and the status is left as it is.
7. **Attribute order:** when Specquer adds `data-status` to an anchor, it writes it after `data-uid`. It keeps attributes in whatever order the user wrote them.
8. **Copies:** a copied section has no status of its own and inherits one. The anchor rules already leave the anchor out of a copy, and the WYSIWYG view's paste replaces an anchor whose ID is taken with a bare `<a id="">`, which drops its status as well; both stay as they are. A placeholder written by hand with a `data-status` (`<a id="" data-status="Approved">`) keeps it when it gets its ID (R1.6).
9. **Agents:** the section anchor rules for agents (`shared/src/sections/agent-guide.ts`, written to `AGENTS.md`, and the same rules in `CLAUDE.md`) gain a rule: change a section's `data-status` only when asked to, and only to an allowed value for its prefix.

<a id="WORK-00449" data-uid="ve130pc8sr0o"></a>
### R2. Allowed Values per Prefix

1. **File:** the allowed statuses for a prefix are in `.specquer/shared/<prefix>/prefix.config.yaml`, next to the prefix's `sections.yaml`. The file is shared (committed). For now it is edited by hand; there is no settings dialog for it. Its name leaves room for other per-prefix settings later.
2. **Format:** a YAML list under `statusValues`, in order:
   ```yaml
   # .specquer/shared/REQ/prefix.config.yaml
   statusValues:
     - Draft
     - Approved
     - In Development
     - Peer Review
     - Testing
     - Complete
   ```
   Spaces at the start and end of each value are ignored. A value may contain commas.
3. **Defaults:** a prefix with no `prefix.config.yaml` allows the following values, in this order:
   1. Draft
   2. Approved
   3. In Development
   4. Peer Review
   5. Testing
   6. Complete
4. **Order:** the order of the list is the order of the dialog's drop-down (R5), and its first value is the prefix's default status (R3).
5. **Changes on disk:** Specquer reads the file again when it changes, as it does for the other configuration files. Effective statuses and status problems follow at once.
6. **A file that can't be used:** when the file doesn't parse, has no `statusValues`, has an empty list, a value that isn't text or is blank, or the same value twice (also when the two differ only in case or surrounding spaces), the prefix uses the default list (R2.3), and the file is a section problem (R6.2).

<a id="WORK-00450" data-uid="vovgm4q522vw"></a>
### R3. Effective Status

1. **Rule:** a section's effective status is:
   1. its own `data-status`, if it has a valid one (R1.4); else
   2. its parent section's effective status, if the parent has the same prefix; else
   3. the first allowed value for the section's prefix (R2.4). With no `prefix.config.yaml` (or one that can't be used), that is "Draft".
2. **Prefix boundary:** inheritance stops where the prefix changes. A `REQ` section inside a `SPEC` section takes `REQ`'s first allowed value, not the `SPEC` parent's status, even if `REQ` allows that status. Inheriting therefore never produces a status the user didn't write that isn't allowed.
3. **The root section:** the root section (the document's own anchor) has no parent, so step 2 doesn't apply to it. Documents don't inherit from one another.
4. **An invalid status of its own:** a section whose own `data-status` is invalid has no valid effective status. The tooltip shows the value as written (R4.1). Its subsections inherit as if it had no status of its own: they take what it would have inherited, by steps 2 and 3.
5. **Explicit values stay explicit:** a section whose own status equals the one it would inherit keeps its `data-status`. It then stays at that value if its parent's status changes later. Nothing in Specquer removes the attribute except the user choosing **Inherited** (R5.4).

<a id="WORK-00451" data-uid="tveiycga7sl0"></a>
### R4. The Section Badge

The badges are those of the preview and split views and the WYSIWYG view (Client Requirements §6.1).

1. **Tooltip:** the first line of the tooltip shows the section ID, a dash and the effective status:
   - a status of its own: "SPEC-00012 - Peer Review";
   - an inherited status: "SPEC-00012 - Draft (inherited)";
   - an invalid status of its own: "SPEC-00012 - Revieww (not allowed)", as written, with the badge's warning ring, as for an ID used more than once (Client Requirements §6.1 item 5).

   The document path and UID follow as now. A duplicate or colliding ID's text and **Renumber this one** are unchanged.
2. **Left click:** clicking a badge no longer copies the section ID; the code for it is removed. The badge stays focusable, and hovering or focusing it still shows the tooltip.
3. **Context menu:** right-clicking a badge opens a menu with:
   - **Copy this section ID**, with a copy icon (lucide `Copy`), which copies the section ID to the clipboard;
   - **Section attributes…**, with a checklist icon (lucide `ListChecks`), which opens the dialog (R5). In a file with merge conflict markers, which saves leave alone (Client Requirements §7 item 4), it is disabled, with a tooltip saying why.
4. **Keyboard:** on a focused badge, the context-menu key and Shift+F10 open the menu, so the ID can still be copied without a mouse.

<a id="WORK-00452" data-uid="e229ks98f333"></a>
### R5. The Section Attributes Dialog

1. **Dialog:** a modal dialog, **Section attributes**, names the section by its ID and title, and holds a **Status** drop-down.
2. **Choices:** the first choice is **Inherited (`<status>`)**, with the status the section would inherit (R3, steps 2 and 3). Then come the allowed values for the section's prefix, in order (R2.4). **Inherited** is offered whether or not the section has a status of its own.
3. **Initial choice:** the section's own status, or **Inherited** when it has none. An invalid status of its own is shown as an extra, disabled choice, "Revieww (not allowed)", selected at first, so the user sees it and picks a valid one; confirming while it is still selected changes nothing.
4. **Applying:** confirming the dialog edits the anchor in the editor's buffer. It adds, changes or removes `data-status` (removes it when **Inherited** is chosen). The dialog never writes to disk: the change is an ordinary unsaved edit, which can be undone and is saved like any other (autosave included). Cancelling changes nothing.
5. **Unchanged choice:** confirming without changing the choice edits nothing.

<a id="WORK-00453" data-uid="x8n6s5xcojgk"></a>
### R6. Section Problems

1. **Invalid status:** a section anchor whose `data-status` isn't valid (R1.4) is a section problem: blank, or not among its prefix's allowed values. It names the file, the line, the section ID, the value and the prefix, for example "docs/a.md, line 14: SPEC-00012's status "Revieww" isn't allowed for SPEC", and opens its file at the section, as other problems do.
2. **Unusable configuration:** a `prefix.config.yaml` that can't be used (R2.6) is a section problem. It names the file and what is wrong (it doesn't parse, the list is missing or empty, a value is blank or not text, or a value is repeated), and says that the prefix uses the default list. It is listed with the problems of every folder that holds sections with that prefix.
3. **Listing:** both appear in **Section problems…** (folder context menu, Client Requirements §3.5), with the others. New `SectionProblem` kinds in `shared/src/api/schemas.ts` carry them.
4. **Read-only:** finding these problems never changes a file. A save leaves an invalid status as it is; only capitalization and surrounding spaces are corrected (R1.5).
5. **Kept current:** they are found again when a file or a prefix's `prefix.config.yaml` changes, as other problems are.

<a id="WORK-00454" data-uid="w4ladyhb9oz4"></a>
### R7. Tests

1. **Unit (`shared`):** reading `data-status` from anchors in every position (root, heading, setext, list item, the anchor paragraph before a heading); `anchorEdits` keeps `data-status` when it adds or corrects an `id` or `data-uid`, and on a prefix change; correcting capitalization and surrounding spaces; adding and removing the attribute; the agent guide's new rule.
2. **Unit (`server`):** reading `prefix.config.yaml` and re-reading it after a change; the default list, with no file and with each kind of unusable file; effective status (own, inherited, the prefix boundary, the root section, a parent with an invalid status); the invalid-status problem for blank values, unknown values and values left invalid by a prefix change; the unusable-configuration problem.
3. **Components:** the tooltip's status line (own, inherited, not allowed) and the warning ring; the context menu (mouse and keyboard, disabled in a file with conflict markers); copying; the dialog's choices, **Inherited**, the disabled invalid choice and the edit it makes to the buffer.
4. **End to end:** set a status from the badge, see the edit in the buffer, save, reload and see it in the tooltip. Write an invalid value by hand and see it in **Section problems…**.

<a id="WORK-00455" data-uid="qh6qo09frw8g"></a>
## 4. Out of Scope

- A settings dialog for `prefix.config.yaml`.
- Status history or an audit trail.
- Rules for allowed transitions (any status can follow any other).
- Showing the status anywhere but the tooltip and the dialog: in the outline, beside headings, or as the badge's color. (The warning ring for an invalid status is a problem marker, not a status color.)
- Filtering or searching by status; status in summaries or chat sources.
- Attributes other than status in the **Section attributes** dialog.

<a id="WORK-00456" data-uid="ls9nqi5yb5z1"></a>
## 5. Specifications to Update

- **[Client Requirements](/specifications/client-requirements):** §6.1, the badge (tooltip, no left-click copy, context menu) and the new dialog; §3.5, the new problem.
- **[Data Architecture](/specifications/data-architecture):** §2.1 and §2.2, `data-status` in section anchors and the effective status; §2.3 or §2.4, `prefix.config.yaml` beside `sections.yaml`; §2.5 and §2.6, the new problems and the correction of capitalization and spaces on save.
- **[Information Architecture](/specifications/info-architecture):** `prefix.config.yaml` in the folder diagram.
- **[Server Requirements](/specifications/server-requirements):** status in the sections API and in the problems listing.
- **`CLAUDE.md`:** `prefix.config.yaml`, and the `data-status` rule in the section anchor rules (R1.9).

<a id="WORK-00457" data-uid="szo31mcmvikb"></a>
## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Agents or people edit anchors by hand | Invalid or misspelled statuses | The agent rule (R1.9); capitalization and spaces are corrected on save; anything else is a section problem and a warning ring (R6, R4.1) |
| A mistake in `prefix.config.yaml` | Every status of the prefix looks invalid | The prefix falls back to the default list, and the file is reported (R2.6, R6.2) |
| Removing click-to-copy | Users who relied on it lose a shortcut | **Copy this section ID** is the first menu item, and the keyboard reaches it (R4.4) |
| `prefix.config.yaml` changes after statuses are in use | Many sections become invalid at once | They are listed as problems and keep their values; nothing is removed |
| Inheritance is invisible in the Markdown | A section's status is hard to tell from the source | The tooltip shows the effective status; the dialog shows what **Inherited** resolves to |

<a id="WORK-00458" data-uid="d7gj8o59fcem"></a>
## 7. Open Questions

None. All were decided while reviewing the requirements: the out-of-scope list (§4); the file's format (R2.2) and name (R2.1); an unusable file (R2.6, R6.2); an invalid status of a section's own (R3.4, R4.1); surrounding spaces (R1.4, R1.5); an invalid value in the dialog (R5.3); inherited statuses in the tooltip (R4.1); copies (R1.8); the agent rule (R1.9); files with conflict markers (R4.3).
