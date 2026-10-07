<a id="SEC-00000"></a>

<a id="SEC-00001"></a>
# Sections

<a id="SEC-00002"></a>
## Definitions

**Section** - One of the following:

* An entire Markdown file (aka a root section)
* A Markdown heading plus all the content following it up to but excluding the next
  heading at an equal or higher level (i.e. same or fewer "#" in the heading definition).
* One item from a bulleted list (aka a bulleted item section).

Note: Root and heading sections are added automaticly (below). Bulleted item sections are added
only when directed by a user. Once the items in a list are made sections, all items in the 
list are automatically kept as sections.

**Section Anchor** - An HTML anchor tag placed just before a section.

A root section anchor appears as the first text in a file (after the frontmatter if any), 
preferably with a blank line after it.
```
<a id="REQ-00234"></a>

... visible file content ...
```

A heading section anchor appears on the line before the heading:
```
<a id="REQ-00257"></a>
## Some Level 2 Subsection

Content included in the section.
```

A bulleted item section anchor goes between the bullet character and the item content:
```
* <a id="REQ-00752"></a> Some requirement here.
```

**Section ID** - A unique ID for the section used in its anchor tag and for links
of various kinds. A section ID consists of a prefix followed by a dash and then
a sequentially generated, zero-padded five digit number. The prefix consists of A-Z followed
by 1 to 4 upper case characters or numbers. E.g. "REQ" or "P5VV3", but not "Req", 
"VERYLONG", "S", or "1WAY".

Note: Because headings are hierarchical, a level 1 section could encompass sections
at levels 2, 3, 4, ... etc. The root section of a document always encompases all the subsections
within the document. Section IDs make no effort to encode the changeable hierarchy.

<a id="SEC-00003"></a>
## Purpose of Sections

The following functionality will be built upon sections as Specquer evolves:

* <a id="SEC-00004"></a> Sections serve as targets of links from elsewhere in the documentation.
* <a id="SEC-00005"></a> In particular, sections are the source and sink for requirements traceability links.
* <a id="SEC-00006"></a> Sections can have sidecar review comment threads attached to them.
* <a id="SEC-00007"></a> Specquer automates hierarchical summarization of documents section by section.
* <a id="SEC-00008"></a> Sections have attached metadata like status, priority, owner, etc.
* <a id="SEC-00009"></a> Sections have a role when document change history is displayed in a granular way.

<a id="SEC-00010"></a>
## Functionality for This Work Item

* Read and write configuration metadata related to documents and sections.
* Automatically add and maintain section anchors.
* In Specquer editors give extra support to creating a link to a section.
* (Section attributes, summarization, review comment threads, and change
  history are out of scope, left for future work.)

<a id="SEC-00011"></a>
## Specquer Configuration File

### Prefixes

File .specquer/shared/section-prefixes.config.yaml contains the following prefix configuration:
* Key: a glob for a folder or .md file
* For each key, the prefix to use in new files that match that glob

Example:
```yaml
prefixes:
  "**/*": REQ
  "documentation/notes/": NOTE
  "documentation/notes/ideas.md": IDEA
  "documentation/specifications/": SPEC
  "documentation/references/": REF
  "documentation/work-items/": WORK
```

Globs are checked in reverse order. In other words they are expected to be listed
in order from least specific to most specific. 

If the configuration file is missing or a file name matches none of the keys given, 
then the default prefix is "REQ".

<a id="SEC-00012"></a>
## Document Data Files

For each .md document in the working directory, file .specquer/shared/documents.yaml
contains the following:
* Key: A CUID2 unique ID (the document ID)
* Value:
  - file path relative to the root working directory
  - (other attributes in the future)

## Section Data Files

For each distinct prefix, file `.specquer/shared/<prefix>/sections.yaml` contains the following data for each 
section:
* Key: A CUID2 unique ID
* Value:
  - id - the anchor ID, e.g. REQ-00023; this becomes a reverse mapping from unique ID to ID
  - documentId - the CUID2 identity of the file containing this section 
  - (other attributes in the future)

Notes:
* An implementation detail will be whether to load these YAML files into a SQLite cache.
* The server will want to track the maximum ID sequence number for each prefix for use when
  assigning new section IDs.
* A new server technology dependency is implied for CUID2.
* New entries are always appended to the end of this file so that conflicts can be
  resolved by assuming the entry appearing earlier in the file is the oldest and precedent entry.

<a id="SEC-00013"></a>
## Section Anchor Insertion

<a id="SEC-00014"></a>
### Timing

Specquery automatically inserts and corrects section anchor tags at the following times:
* When a file is opened, before it is displayed.
* Before a file is saved.
* When the browser tab showing a file has been reactivated and the file has been changed externally.
* Asynchronously in the background, every Markdown file under the root working directory.

<a id="SEC-00015"></a>
### ID Generation

Whenever a new section is identified, the server increments the last known ID sequence number
for the prefix and prepends the prefix and dash. The server also generates a corresponding CUID2
ID value to aid in conflict resolution.

<a id="SEC-00017"></a>
### Document Conflict Resolution

Whenever external changes are possible, Specquer looks for and resolves conflicts:
* A document not in the documents.yaml file.
  - The document is added to the YAML file with a new CUID2.
  - All its sections are added or updated in `<prefix>/sections.yaml`
* A nonexistent document in documents.yaml.
  - The entry for the obsolete document is removed.
* Note: At this time no effort is made to detect a file that has been extenrally
  moved or renamed, perhaps with minor changes. Future work may cover this more subtle option.
 
### Section Conflict Resolution
* Same section ID used in multiple places in one document.
  - The first occurrence is kept, later occurrences are revised with new
    section IDs.
  - Note: Future revisions will look to distinguish which is the oldest.
* Same section ID used in multiple documents.
  - If the section ID is present once in `<prefix>/sections.yaml`, all other
    uses of the same section ID are revised to use new section IDs.
  - If the section ID appears multiple times in `<prefix>/sections.yaml`,
    then the first is kept and subsequent occurrences are revised along
    with any brand new occurrences not in `<prefix>/sections.yaml`.
* Section ID in a document not stored in the `<prefix>/sections.yaml` file.
  - Update `<prefix>/sections.yaml` accordingly
* Section ID in `<prefix>/sections.yaml` no longer appears in any document.
  - Remove the entry from `<prefix>/sections.yaml`

<a id="SEC-00018"></a>
## User Interface Additions 

<a id="SEC-00019"></a>
### Badges
* In preview and split pane views, a badge is displayed to the left of each section heading
  or between the bullet and content of a bulleted item section.
* Huge TBD: Can Milkdown editing also be customized to display these badges and not display
  section anchor tags? This may need some experimentation. If not, it may spell the
  end of WYSIWYG editing.
* The badge appears on screen as the same image as the application's SVG favicon.
* Hovering a badge shows a tooltip containing the section's data (for now just the section's
  CUID2 value; more will come in the future).

## Changes to Existing Functionality
* When a file or folder is renamed, documents.yaml is updated with the new path(s).
* When a file or folder is deleted, documents.yaml and `<prefix>/sections.yaml` files are
  updated to remove obsolete entries.

## Documentation Updates
* Link this document to the VitePress navigation.
* Update documents in documentation/specifications to include these changes.

<a id="SEC-00020"></a>
## Feedback

Review comments on the requirements above, with what Step 001 already built in mind.

1. **Front matter comes first.** A root section anchor can't be "the first text in a file" when
   the file has front matter: the `---` block must be on the first line or it stops being front
   matter. The root anchor should go directly after the front matter block.
2. **Only real Markdown structure counts.** Headings, list items and anchors must be found by
   parsing the Markdown (the `shared` pipeline), not by matching lines. Otherwise a `#` line or an
   `<a id>` inside a fenced code block becomes a section, as the examples in this document would.
   This also settles setext headings (`===` underlines), which are headings, and HTML `<h2>`
   tags, which aren't.
3. **Opening a file changes it.** Inserting anchors when a file is opened, or in a background pass
   over every Markdown file, writes to files the user only looked at. That means Git changes in
   files like `README.md`, `CHANGELOG.md`, `CLAUDE.md` or vendored docs, and edits racing with a
   coding agent that is working on the same file. The background pass is the biggest risk, since
   it touches every Markdown file under the root at once (see Q3).
4. **The editor and the file must stay in step.** Step 001's save sends the text and the version
   it was based on; the server writes it unchanged. If the server inserts anchors while saving,
   the client's copy no longer matches the file, and the next save fails the version check.
   The save response needs to return the text as written (or the client inserts anchors itself
   with IDs it got from the server), and the editor has to apply it without moving the cursor.
5. **Reactivated tabs.** Step 001 only notices external changes when it saves. Re-checking a file
   when its tab becomes visible again is new behavior: a version check on `visibilitychange`,
   with the same conflict dialog when there are unsaved edits.
6. **What "first" means for duplicates.** For "same section ID used in multiple documents", the
   occurrence to keep should be the one in the document `sections.yaml` records for that ID
   (its `documentId`), not whichever is found first. For duplicates within `sections.yaml`
   (which only a Git merge can produce), "first" needs a defined order, such as file order of the
   YAML or the document's path.
7. **Git merges.** `.specquer/shared/` is meant to be committed. Two branches that both add
   sections will both use the next sequence numbers, and both append to the same YAML files, so
   merges conflict in the data files and produce duplicate IDs in the documents. The duplicate
   rules repair the IDs afterwards, but links made on either branch may then point at the
   renumbered section. Writing the YAML files sorted, one entry per key, keeps merge conflicts
   small. The highest sequence number per prefix should be recomputed from the documents (the
   maximum of the stored and the scanned value) rather than trusted from the stored file alone.
8. **The CUID2s aren't in the documents.** A section's CUID2 is stored only in `sections.yaml`,
   keyed by the anchor ID, so it can't tell two copies of the same anchor apart, and it is lost
   when a file is renamed outside Specquer. The same applies to the document CUID2, which is
   matched only by path. It would help to say what the CUID2s are for in this step (see Q6).
9. **Anchors and the preview.** The preview's sanitizer keeps `id` attributes on `<a>` but
   prefixes them with `user-content-` (against DOM clobbering, decision D15 in Step 001), and it
   rewrites only same-page `#id` links. Links to a section in another file
   (`other.md#SEC-00004`) need the same treatment, and the badges have to find anchors under the
   prefixed name.
10. **Milkdown.** Besides showing badges (the TBD under Badges), WYSIWYG editing must not drop or
    escape the anchors when it serializes Markdown. Step 001 only writes Milkdown's output after
    the user edits in it, but any edit there would still rewrite the whole body. This needs the
    same spike as the badges, before the rest of the work depends on it.
11. **Badges.** A tooltip that only appears on hover can't be reached by keyboard; the badge
    should also be focusable. The CUID2 is the one value a user can't use for anything; the
    section ID itself (with a copy-link action) would be more useful (see Q11).
12. **Section links.** "Extra support for creating a link to a section" is in scope, but no
    requirement says what it is: completion of section IDs while typing a link, a "copy link"
    action on the badge, a picker, or link checking (see Q10).
13. **Other existing functionality.** Creating a file or folder (Step 001's New File) should add
    the document and its root anchor at once. Renaming a folder changes the prefix that new files
    in it would get, but should never change existing IDs.
14. **Sequence numbers.** Zero-padded to five digits caps a prefix at 99,999 sections. The
    requirements should say what happens after that (allow more digits).
15. **Format details.** The section ID pattern is `^[A-Z][A-Z0-9]{1,4}-[0-9]{5}$` as written.
    "Globs" such as `documentation/notes/` are folder paths, so the rule for a key ending in `/`
    (the folder and everything in it) should be stated. Anchor insertion must keep each file's
    line endings and byte-order mark, as saving does today.
16. **Typos.** "automaticly", "encompases", "extenrally", "Specquery". The headings "Prefixes",
    "Section Data Files", "Section Conflict Resolution" and "Changes to Existing Functionality"
    have no anchors yet, and SEC-00016 is unused.
17. **`<prefix>` breaks the docs build.** Outside code spans, `<prefix>` in paths such as
    `.specquer/shared/<prefix>/sections.yaml` is read as an unclosed HTML tag. VitePress stops the
    build with "Element is missing end tag", and Specquer's preview drops it as unknown HTML.
    Putting the paths in backticks fixes both. _Fixed:_ the paths are now in backticks.

<a id="SEC-00021"></a>
## Questions

Each question has a suggested answer to accept or replace.

1. **Which lists can be sectioned?** Only bulleted lists, or also numbered lists and task lists
   (where would the anchor go relative to `[ ]`)? What about nested lists: does sectioning a list
   section its sub-lists too? _Suggested:_ bulleted and numbered lists, anchor after the task box,
   nested lists only when directed separately.
   A: All three kinds of lists, nested lists may NOT be treated as sections
3. **How does a user direct that a list become sections, and how is that remembered?**
   _Suggested:_ a badge-area or context action in the editors, and a list counts as sectioned
   whenever any of its items has an anchor, so new items in it get anchors automatically.
   A: For this increment of work, the user must manually put in an anchor tag with a section
      ID. It's crude for now, but will have a better UI in future when we work on badge
      behavior and other aspects.
5. **Which files get anchors automatically?** Every Markdown file under the root, or only files
   matching the prefix configuration (or another opt-in list)? And should the background pass
   write files, or only report? _Suggested:_ only files that match a key in the configuration
   file, with no `"**/*"` default unless the user adds it; no automatic writes to files that
   aren't open except through an explicit "add anchors to all files" command.
   A: As suggested
7. **When are anchors inserted in an open file?** On open, on save, or both? _Suggested:_ on save
   only, so viewing never changes a file.
   A: As suggested
9. **"The prefix to use in new files":** does the prefix apply to new sections in any file
   matching the glob, or only to files created after the configuration? If a file is moved to a
   folder with another prefix, do its new sections use the new prefix, so one file mixes
   prefixes? _Suggested:_ new sections use the prefix that matches the file's current path; IDs
   never change once assigned.
   A: As suggested
10. **What are the CUID2s for in this step?** Do they need to exist now, or can they wait for the
   features that use them (comments, metadata)? Should the document's CUID2 be stored in the
   file (for example in the root anchor or the front matter) so it survives renames outside
   Specquer? _Suggested:_ keep them, and store the document CUID2 in the root anchor as a
   `data-` attribute.
   A: As suggested, and that makes it more feasible to manage file move or rename in conflict
      resolution for this work item.
11. **Can IDs be reused?** When a section is deleted, may its number be assigned again?
   _Suggested:_ never; the sequence only increases, so old links never point at a new section.
   A: As suggested
13. **Is `.specquer/shared/` committed to Git?** Step 001 ignores `.specquer/user/` only.
   _Suggested:_ yes, committed, with sorted YAML to keep merges small (Feedback 7).
   A: Yes
15. **YAML or SQLite?** The notes leave it open. _Suggested:_ YAML in `.specquer/shared/` as the
   committed source, with an in-memory index built at startup; SQLite only if startup on large
   repositories proves slow.
   A: Concur, leave out SQLite for this work
17. **What does link support include?** _Suggested:_ completion of section IDs after `#` in a
    Markdown link in the text editor, and "copy link" on each badge; link checking later.
    A: Good suggestions
19. **What does the badge tooltip show?** _Suggested:_ the section ID and the document path,
    with the CUID2 only as secondary detail.
    A: OK; will change in future
21. **What if WYSIWYG can't keep anchors or show badges?** Drop WYSIWYG, make it read-only, or
    hide anchors only in the preview? _Suggested:_ decide after a spike at the start of the work;
    if it fails, mark WYSIWYG experimental and warn before editing a sectioned file in it.
    A: As suggested
23. **Do section IDs ever appear in headings' text** (for example to show them in GitHub's
    rendering)? _Suggested:_ no; the anchor is invisible on GitHub and the badge shows it in
    Specquer.
    A: Only if a user manually types it there
