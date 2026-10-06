
# Ideas

## Purpose

* Specquer is a software development tool for viewing, reviewing, and summarizing software
  specifications written in Markdown.
* Specquer adds to the base functionality of typical Markdown editors the following features:
  - AI-generated summarization of collapsible/expandable sections (by heading).
  - Semi-structured management of spec document sections and subsections.
  - Navigation among sections of interrelated spec documents in the sense of requirements traceability.
  - Automated synchronization of parallel specs with two different focuses: 
    - specification of the intended overall state of a system, and
    - specification of incremental changes to the system - use cases/stories/tasks/units of work.

## Scope

**In Scope**: Everything around creating, editing, evolving, reviewing, navigating, linking, and 
auditing specification documents and their history.

**Out of Scope**: Code generation from those specs. (Specquer works side by side with coding agents)

## Users

The following are expected user categories for Specquer:
* _Developers_ writing functional specs for software development in concert with AI coding agents.
* _Business Analysts_ working cooperatively with developers, especially for requirements-
  focused specs.
* _Testers_ reviewing specs and creating test plans and test cases.
* _Coding Agents_ that create or edit specs from user prompts from humans in the above categories.

## Execution Context

* Specquer focuses on a collection of Markdown files kept in a folder structure in Git.
* The root folder is the working directory where the application was launched.
* Spec files make typical use of nested hierarchical Markdown headings (#, ##, ###, etc.).
* Files support GitHub Formatted Markdown.
* Files *do not* support MDX.
* Files *do not* support YAML front matter.
* Specquer maintains its own configuration in folder .specquer, a subfolder of the root folder.
  - Persistent user state
  - TBD configuration settings
  - The cached Markdown database of spec document nodes, sections, interrelations, etc.

## Markdown Documentation Viewer

The primary view of Specquer consists of a typical split pane with folder structure on the left 
and a selected file open on the right.

### Left Pane

* The left pane shows a typical tree view of folders and files.
* The root folder is the working directory where the application was launched.
* Only *.md files are shown.
* A file is opened in the right pane by single clicking it in the left pane.
* The folder view as a fraction of the display can be widened or narrowed with a drag bar. This change
  persists in file .specquer/uistate.yaml.
* Individual folders can be expanded or collapsed; their collapse state is remembered in folder 
  .specquer/uistate.yaml.

### Right Pane

* The right pane document view can be switched between four view type options:
  - editable plain text
  - a split view with editable plain text left and read-only preview HTML right
  - styled HTML output (read-only)
  - WYSIWYG editable rich text
* Editable plain text view is implemented with CodeMirror.
* Read-only preview HTML is implemented with react-markdown.
* Editable WYSIWYG rich text is editable with Milkdown.
* Only one file at a time is open in the right pane; there are no file tabs.
* Edited file content is saved automatically before a different file is opened, when the browser
  tab loses focus, or every 60 seconds (if there are changes).
* Browser back and forward navigation covers changes to the focused/editable file.
* Changes to the right pane view type also show up in the browser history.

## Automated Summarization

* In the styled preview pane, each section in the heading hierarchy can be summarized with AI.
* Summaries are stored in the database for each section and subsection.
* In the preview pane summaries are toggled conceptually like code collapse in an IDE editor except 
  accounting for the hierarchy.
* For example, in a document with three levels of headings there could be five levels of collapse:
  - Show the whole document in the normal way.
  - Summarize heading 3 sections with AI, keeping each heading 3 with one summary paragraph for its content.
  - Summarize heading 2 sections with AI, keeping each heading 2 with one summary paragraph that covers 
    all the heading 3 subsections (heading 3 values are hidden, replaced by the heading 2 summary).
  - Summarize heading 1 section content with AI, keeping each heading 1 with one summary paragraph that covers
    all the heading 2 subsections (heading 2 and 3 values are hidden, replaced by the heading 1 summary).
  - Summarize the whole document, hiding all headings and subsections.
* Summaries are generated from the raw content of their entire section, not by summarizing the summaries
  of nested subsections.
* If a document has content before the first heading, that content does not participate in summarization
  or collapse unless the whole document is collapsed and summarized.
* The user interface allows expanding or collapsing individual subsections within a parent section 
  that is expanded enough to show the subsection headings.
* There is an expand all / collapse all capability to reduce or increase the degree of 
  summarization in a section's subsections.
* Summaries are generated on the fly when first needed, with a UI placeholder something like "Summarizing..."
  holding the space until completed. Once cached, summaries are retrieved and reused.
* The Markdown database caches summaries by section/subsection. Cached values must be regenerated
  whenever the corresponding summarized content changes. The preview functionality makes use of cached
  summaries.

## Dual View of Specifications

* Spec files managed through Specquer can have arbitrary names and folder structure except as
  follows. One subfolder of the root folder named "work-items" is designated for incremental changes. 
  Each subfolder of that folder then is treated as a unit of work, story, task, or use case. In
  Specquer they are just called "work items".
* When a user or agent adds or modifies a work item (one or more spec files within a work item folder),
  Specquer's AI agent is responsible (when requested) for updating the non-work item specifications 
  to incorporate the changes from the work item across the system specification as a whole.

## Markdown Database

* Specquer keeps a local database that caches the information Specquer generates about the spec
  files in its working directory structure.
* The nodes of the Markdown files are mapped as "objects" in the database.
* To the extent possible, the identity of Markdown fragments is preserved from one revision (git 
  commit) to the next.
  - Use TBD algorithms to detect similarity of fragments.
  - Not just a normal text diff - look for moved fragments with or without minor modifications.
  - Represent changes as internal diffs within fragments and external diffs of fragment location.
* The database stores fragments and their history.
* The comparatively linear structure of Markdown headings and paragraphs is supplemented by a
  tree of larger and smaller sections, each starting with a heading. Each "section" consists of
  a heading plus all the content up to the next heading at the same or higher level.

---

## Open Questions

### Overall

1. **First version.** The fragment-identity database and work-item synchronization are by far the hardest parts. Could a first version deliver the viewer, editing and summaries with simple content-hash caching, and add fragment identity, traceability and work-item synchronization later?
2. **Reviewing and auditing.** Reviewing and auditing are in scope, but no feature describes them yet. Do they mean review comments on sections, approvals or sign-off, a history view of sections across commits, or something else? Where would review data live: in the Markdown, in `.specquer`, or in Git (for example as pull requests)?
3. **Coding agents as users.** How do coding agents work with Specquer: by editing the Markdown files directly while Specquer reacts to the changes, or through an interface Specquer provides (such as an HTTP API, a CLI or an MCP server)? Can agents use summaries and traceability links too?
4. **Requirements traceability.** Is section identity written into the Markdown or inferred by Specquer? Traceability links target sections, and ordinary links to heading anchors break when a heading is reworded. An explicit ID in the Markdown, such as an HTML comment after the heading (`<!-- id: REQ-12 -->`) or an ID in the heading text (`### REQ-12 Password rules`), is stable and travels with every clone, but is visible in the files and must be maintained. IDs kept only in the database leave the files clean, but are only as reliable as the fragment-identity algorithm, and travel with the repository only if `.specquer` is committed (see question 7).

### Execution Context

5. **Root folder and Git.** Must the working directory be the root of a Git repository, or can it be a subfolder of one? What happens if it is not in a Git repository at all?
6. **Front matter and MDX in existing files.** Files may still contain YAML front matter, MDX or raw HTML, for example when a project's existing docs are used with Specquer. Are these shown as plain text, rejected, or flagged with a warning?
7. **Is `.specquer` committed?** Is `.specquer` committed and shared with the team, or ignored by Git? It mixes per-user state (`uistate.yaml`) with a cache that could be shared. If the cache is never committed, fragment identity and traceability links must be rebuildable deterministically from Git history. Should the per-user and shared parts be separated, with Specquer adding the right `../../.gitignore` entries?
8. **Network exposure.** The browser UI can write files in the working directory. Does the server listen only on `localhost`? Can several Specquer instances run at once (in different repositories) on different ports?

### Markdown Documentation Viewer

9. **Folder pane filtering.** Besides showing only `.md` files, does the folder pane respect `../../.gitignore`, and hide `.specquer`, `node_modules` and folders with no Markdown files?
10. **File operations.** Creating specs is in scope. Can files and folders be created, renamed, moved and deleted from the folder pane? Do renames and moves keep fragment identity and traceability links?
11. **Milkdown round-trip fidelity.** WYSIWYG editors usually rewrite Markdown they did not change: list markers, emphasis characters, line wrapping, table spacing. Opening and saving a file in Milkdown could create noisy Git diffs and break fragment identity. Must WYSIWYG editing preserve the original Markdown text exactly outside the edited parts?
12. **External changes and conflicts.** Coding agents and other editors change files while they are open in Specquer. Does Specquer watch the file system and reload? If a file changes on disk while it has unsaved edits, which version wins, and is the user told?
13. **Autosave and undo.** Autosave writes to the working tree every 60 seconds. Does undo history survive a save? Does it survive switching files and coming back?
14. **Browser history.** Does "changes to the focused/editable file" mean switching which file is open, or individual edits? Should back and forward also restore scroll position and section collapse state?
15. **Split-view synchronization.** Should the split view keep the preview scrolled to the part being edited? Synchronized scrolling needs a map from rendered elements back to source positions. Remark's syntax tree has positions, but react-markdown hides most of them. Is synchronization per section good enough?
16. **Links, images and search.** Do relative links between documents open them in Specquer, and do heading anchors scroll to the section? Are images shown? Is there search, across files or by section?

### Automated Summarization

17. **Which views show summaries?** Do summaries and collapsing appear only in the read-only styled view, or also in the split view's preview and the WYSIWYG view? If the WYSIWYG view can be collapsed, can summarized sections be edited?
18. **Summary levels across documents.** The example assumes a document using H1 to H3. Are the levels counted per document, so that a document starting at H2 gets one level fewer? How are skipped levels (H1 directly to H3) handled?
19. **A section's own content.** At the "summarize heading 3 sections" level, is the text directly under an H2 (before its first H3) shown in full, or summarized?
20. **Long sections.** Summarizing from raw content means a whole-document summary sends the entire document to the model. What happens when a document is longer than the model's context window, or expensive to summarize in one call?
21. **Saved or unsaved content.** Is a summary generated from the saved file or from the editor's current, unsaved text? Does an edit in progress invalidate the summary immediately or only after the next save?
22. **What counts as a change.** Does fixing a typo or whitespace force regeneration? Reusing the identity algorithm's notion of a minor change would avoid needless model calls.
23. **Cost and data leaving the machine.** Each summary sends specification text to a model provider. Is summarization opt-in per repository? Whose API key is used, and where is it configured? Does Specquer work offline with summaries disabled?
24. **Trust signals.** Should summaries be marked as AI-generated, show when they are stale, and offer a one-click way to see the source text?
25. **Section collapse state.** Is section collapse state stored in `.specquer/uistate.yaml` like folder collapse state, per document? Does it appear in browser history?

### Dual View of Specifications

26. **Work item structure.** Is the `work-items` folder name fixed or configurable? Can work items be nested, or grouped (for example by release)? Does a work item have a required file or structure, such as a main spec file?
27. **Work item lifecycle.** What states does a work item go through (draft, in progress, incorporated, done)? Where is that state recorded without front matter? Once a work item has been incorporated into the system specification, is it kept, archived or deleted?
28. **How the agent applies changes.** When the agent incorporates a work item, does it edit the system specification directly, or propose changes for review (for example as a diff the user accepts section by section)? Does each incorporation become its own Git commit?
29. **Overlapping work items.** How are two open work items that change the same system section handled? Does the order of incorporation matter?
30. **Changes in the other direction.** If the system specification is edited directly (not through a work item), does anything flow back to open work items, or flag them as out of date?
31. **Traceability between the views.** After incorporation, are work-item sections linked to the system sections they changed, so that a reviewer can see why a requirement exists and which work item introduced it?

### Markdown Database

32. **Uncommitted changes and branches.** Identity is preserved from one Git commit to the next, but autosave edits the working tree between commits. Do summaries, links and identity apply to uncommitted content? How are branches handled, given that a fragment can have different histories on different branches?
33. **Fragment granularity.** Is a fragment a section, or every block node in the Markdown syntax tree (paragraph, list item, table row)?
34. **Identity edge cases.** How are these handled: a section split in two or two merged into one, a fragment moved to another file, a renamed file? At what point does a modified fragment become a new one? Traceability links depend on the answer.
35. **Duplicate headings.** How are sections identified when a document has two headings with the same text?
36. **Startup cost.** On first launch in a large repository with a long history, building the database means analyzing every commit. Is the history built in the background, limited to recent commits, or built only on demand?
