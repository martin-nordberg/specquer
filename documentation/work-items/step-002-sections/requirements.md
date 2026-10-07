<a id="WORK-00000"></a>

<a id="WORK-00001"></a>
# Sections

_Step 002 requirements. The [implementation plan](implementation-plan.md) records the design and
the decisions taken while planning._

<a id="WORK-00002"></a>
## Definitions

**Section** - One of the following:

* An entire Markdown file (a **root section**).
* A Markdown heading plus all the content following it, up to but excluding the next heading at an
  equal or higher level (the same or fewer `#` characters). Only headings at the top level of the
  file count; headings inside block quotes or lists don't.
* One item of a list (a **list item section**). Bulleted, numbered and task lists can all be
  sectioned. Items of nested lists are never sections.

Root and heading sections are added automatically (see Section Anchor Insertion). List item
sections are added only when the user directs it, and once a list's items are sections, all items
in that list are kept as sections.

Sections are found by parsing the Markdown, not by matching lines: a heading or an anchor inside a
code block is not a section. Setext headings (text underlined with `===` or `---`) are headings.

Because headings are hierarchical, a level 1 section can contain sections at levels 2, 3, 4 and
so on, and the root section of a file contains all of its sections. Section IDs make no attempt to
encode this hierarchy, which changes as documents are edited.

**Section Anchor** - An HTML anchor tag that marks a section and carries its section ID.

A root section anchor is the first content of a file, after the front matter if there is any,
followed by a blank line. It also carries the document's ID (see Document Data):
```
<a id="REQ-00234" data-document-id="tz4a98xxat96iws9zmbrgj3a"></a>

... visible file content ...
```

A heading section anchor is on its own line before the heading. A blank line between the two is
allowed (the WYSIWYG editor adds one):
```
<a id="REQ-00257"></a>
## Some Level 2 Subsection

Content included in the section.
```

A setext heading would absorb a line directly above it into its text, so its anchor starts the
heading's first line instead:
```
<a id="REQ-00258"></a> Some Setext Heading
==========================================
```

An anchor at the start of a heading's text (`## <a id="REQ-00259"></a> Title`) is also recognized,
since the WYSIWYG editor can produce that form.

A list item section anchor goes between the list marker (and the task box, if any) and the item's
content:
```
* <a id="REQ-00752"></a> Some requirement here.
1. <a id="REQ-00753"></a> A numbered requirement.
- [ ] <a id="REQ-00754"></a> A requirement still to do.
```

**Section ID** - A unique ID for the section, used in its anchor and in links to it. It is a
prefix, a dash and a sequence number of at least five digits, zero-padded
(`^[A-Z][A-Z0-9]{1,4}-[0-9]{5,}$`). The prefix is an upper-case letter followed by 1 to 4
upper-case letters or digits: "REQ" or "P5VV3", but not "Req", "VERYLONG", "S" or "1WAY". Numbers
past 99999 simply have more digits.

Section IDs are never reused: once assigned, a number is not assigned again for the same prefix,
even after its section is deleted, so an old link never leads to a different section. A section ID
never changes once assigned, except to resolve a duplicate (see Conflict Resolution).

Section IDs appear in a heading's text only if a user types them there.

A **placeholder anchor** is an anchor in a section anchor's place whose `id` is not in the section
ID format, blank included (`<a id=""></a>`, `<a id="new"></a>`). It asks Specquer to assign a
section ID, and is replaced by a regular section anchor.

A **known prefix** is one that is a value in the prefix configuration or already has a
`sections.yaml`. An ID with any other prefix is renumbered with the file's prefix (see Section
Conflict Resolution).

<a id="WORK-00003"></a>
## Purpose of Sections

The following functionality will be built upon sections as Specquer evolves:

* <a id="WORK-00004"></a> Sections serve as targets of links from elsewhere in the documentation.
* <a id="WORK-00005"></a> In particular, sections are the source and sink for requirements traceability links.
* <a id="WORK-00006"></a> Sections can have sidecar review comment threads attached to them.
* <a id="WORK-00007"></a> Specquer automates hierarchical summarization of documents section by section.
* <a id="WORK-00008"></a> Sections have attached metadata like status, priority, owner, etc.
* <a id="WORK-00009"></a> Sections have a role when document change history is displayed in a granular way.

<a id="WORK-00010"></a>
## Functionality for This Work Item

* Read and write the configuration and data files for documents and sections.
* Automatically add and maintain section anchors.
* Help the user create links to sections in Specquer's editors.
* Out of scope, left for future work: section attributes, summarization, review comment threads,
  change history, a user interface for turning a list into sections, and SQLite.

<a id="WORK-00011"></a>
## Configuration

All of Specquer's shared files live in `.specquer/shared/`, which is committed to Git (unlike
`.specquer/user/`).

### Prefixes

`.specquer/shared/section-prefixes.config.yaml` says which files are sectioned and which prefix
their new sections get:

* Key: a glob matching workspace paths (relative to the root folder). A key ending in `/` matches
  that folder and everything in it.
* Value: the prefix for new sections in files that match.

Example:
```yaml
prefixes:
  "documentation/notes/": NOTE
  "documentation/notes/ideas.md": IDEA
  "documentation/specifications/": SPEC
  "documentation/references/": REF
  "documentation/work-items/": WORK
```

Keys are checked from the last to the first, so they are listed from least to most specific.

Only Markdown files that match at least one key are sectioned. If the configuration file is
missing, no file is sectioned. There is no built-in `"**/*"` default; a user who wants every file
sectioned adds that key.

New sections use the prefix for the file's current path. A file moved to a folder with another
prefix keeps its existing section IDs, and its new sections get the new prefix, so one file can
mix prefixes.

<a id="WORK-00012"></a>
## Document Data

`.specquer/shared/documents.yaml` lists every sectioned document:

* Key: a CUID2 (the **document ID**).
* Value: the file's workspace path (and other attributes in the future).

The document ID is also stored in the file itself, in the root anchor's `data-document-id`
attribute, so a document keeps its identity when it is moved or renamed outside Specquer.

## Section Data

For each prefix, `.specquer/shared/<prefix>/sections.yaml` holds:

* The highest sequence number ever assigned for the prefix, so numbers are never reused.
* For each section:
  - Key: a CUID2 (the section's unique ID).
  - `id`: the section ID, such as REQ-00023.
  - `documentId`: the ID of the document containing the section.
  - (Other attributes in the future.)

New entries are always appended to the end of the file, so when entries conflict, the one earlier
in the file is taken to be the older one and wins.

The server keeps an in-memory index of these files and of the sections found in the documents.

<a id="WORK-00013"></a>
## Section Anchor Insertion

<a id="WORK-00014"></a>
### Timing

Viewing a file never changes it. Specquer inserts and corrects section anchors:

* When a file is saved, before it is written.
* When a sectioned file is created with **New file**: it starts with its root anchor.
* When the user runs **Add section anchors** on a folder, for every sectioned file in it. This is
  the only way files that aren't open get anchors. Specquer shows how many files will change and
  asks first.

Specquer also reads every sectioned file in the background, at startup and when files may have
changed outside it, to bring its in-memory index up to date. This reading never writes any file,
neither documents nor data files, so opening Specquer on a fresh clone or after a branch switch
leaves the working tree unchanged.

Specquer writes documents and data files only when the user changes something: saving, **New
file**, renaming or deleting in Specquer, and **Add section anchors**. A data file written then
holds the whole reconciled state, including fixes found by the background reading.

The editor shows the anchors inserted on save at once, without losing the cursor position or
treating them as unsaved changes.

<a id="WORK-00015"></a>
### ID Generation

For each new section the server takes the next sequence number for the prefix and generates a
CUID2 for its entry in `sections.yaml`. The next number is one more than the highest of: the
stored highest number, the numbers in `sections.yaml`, and the numbers found in the documents.

Anchors are inserted for root sections and top-level headings that lack one, and placeholder
anchors are replaced. A list is sectioned when the user has typed an anchor into at least one of
its items, usually a placeholder (`* <a id=""></a> Some requirement`). Specquer then assigns its ID
and adds anchors to the list's other items.

An ID typed in the section ID format is kept as it is, as an ID arriving from another branch would
be, unless it is already taken or its prefix isn't known; then it is renumbered.

Insertion keeps each file's line endings and byte-order mark, as saving does.

<a id="WORK-00017"></a>
### Document Conflict Resolution

Whenever external changes are possible, Specquer resolves conflicts between the documents and
`documents.yaml`:

* A sectioned document with no document ID in its root anchor: it gets the ID recorded for its
  path, or a new CUID2, which is added to `documents.yaml`.
* A document whose ID is recorded for another path that no longer holds that document: the
  document was moved or renamed, and its path is updated.
* The same document ID in more than one file (a copy): the file at the recorded path keeps it, or
  the first file by path if none is at the recorded path. The others get new document IDs.
* A document ID in `documents.yaml` that no file holds any more: the entry is removed, along with
  its sections' entries.
* A document whose path no longer matches the prefix configuration (a key removed or changed): its
  entry and its sections' entries are removed. The anchors stay in the file, untouched.

### Section Conflict Resolution

* The same section ID used more than once in one document: the first occurrence keeps it, and
  later occurrences get new IDs.
* The same section ID used in more than one document: the occurrence in the document that
  `sections.yaml` records for it keeps the ID (the earliest such entry, if there are several), or
  the first by path if none is there. The others get new IDs.
* A section ID found only in a document other than the one `sections.yaml` records for it: the
  section was moved (a heading cut from one document and pasted into another takes its anchor
  along). It keeps its ID and CUID2, and its `documentId` is updated.
* A section ID with a prefix that isn't known: it gets a new ID with the file's prefix.
* A section ID in a document but not in `sections.yaml`: an entry is added.
* A section ID in `sections.yaml` that no document contains any more: the entry is removed.

Fixes that change a document are made when it is next saved or when **Add section anchors**
covers it. Until then the index records the duplicates. Fixes to the data files alone are written
with the next change that writes them (see Timing).

<a id="WORK-00018"></a>
## User Interface Additions

<a id="WORK-00019"></a>
### Badges

* In the preview and split views, a badge appears at the start of each section heading, between
  the list marker and the content of a list item section, and at the top for the root section.
  It replaces the anchor, which stays invisible.
* The badge is the application's favicon (the § on its blue tile).
* Hovering or focusing a badge shows a tooltip with the section ID and the document path, and the
  section's CUID2 as secondary detail. Badges can be reached with the keyboard.
* Clicking a badge copies its section ID.
* WYSIWYG editing must keep anchors intact. Whether it can show badges in place of the anchors is
  settled by a spike at the start of the work; if it can't, the WYSIWYG view is marked
  experimental and warns before editing a sectioned file.

### Links to Sections

* In the text editor, typing `#` inside a Markdown link target offers completion of section IDs,
  each shown with its heading text and document. Choosing one inserts the path to its document
  (relative to the open file, or nothing for the same file) and the ID.
* Following a link to a section of another document in the preview opens that document and
  scrolls to the section.

## Changes to Existing Functionality

* When a file or folder is renamed, `documents.yaml` is updated with the new paths.
* When a file or folder is deleted, `documents.yaml` and the `sections.yaml` files drop the
  obsolete entries.
* **New file** creates a sectioned file with its root anchor instead of empty.

## Documentation Updates

* Link this document and the implementation plan in the VitePress navigation.
* Update the documents in `documentation/specifications` to include these changes.
