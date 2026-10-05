
# Ideas

## Context

* A collection of Markdown files kept in Git.
* Files make typical use of nested hierarchical headings.
* Files support GitHub Formatted Markdown.
* Files support MDX for React components.
* Files support YAML frontmatter.

## Markdown Database

* Map the nodes of the Markdown files as "objects" in the database.
* To the extent possible preserve the identity of Markdown fragments from one revision to the next.
  - Use TBD algorithms to detect similarity of fragments.
  - Not just a normal text diff - look for moved fragments with or without minor modifications.
  - Represent changes as internal diffs within fragments and external diffs of fragment location.
* The database stores fragments and their history.
* The comparatively linear structure of Markdown headings and paragraphs is supplemented by a
  tree of larger and smaller sections, each starting with a heading. Each "section" consists of 
  a heading plus all the content up to the next heading at the same or higher level. 

## Markdown Documentation Viewer

* Typical split pane with folder structure on left and selected file content on right
* The right pane document view can be switched between plain text, or styled HTML, or a split view that stays in sync.
* The plain text view is implemented with CodeMirror.
* The styled view of the split pane is implemented with react-markdown.
* The folder view can be expanded or collapsed and widened or narrowed with a drag bar.

## Automated Summarization

* In the styled preview pane, each section in the heading hierarchy can be summarized with AI.
* Summaries are stored in the database for each section and subsection.
* In the preview pane summaries are toggled conceptually like code collapse in an IDE editor except 
  accounting for the hierarchy.
* For example, in a document with three levels of headings there could be five levels of collapse:
  - Show the whole document in the normal way.
  - Summarize heading 3 sections with AI, keeping each heading 3 with one summary paragraph for its content.
  - Summarize heading 2 sections with AI, keeping each heading 2 with one summary paragraph that covers 
    all the heading 3 subsections (heading 3 values are hidden/summarized).
  - Summarize heading 1 section content with AI, keeping each heading 1 with one summary paragraph that covers
    all the heading 2 subsections (heading 2 and 3 values are hidden/summarized).
  - Summarize the whole document, hiding all headings and subsections.
* The user interface allows expanding or collapsing individual subsections within a parent section 
  that is expanded enough to show the subsection headings.
* There is an expand all / collapse all capability to reduce or increase the degree of 
  summarization in a section's subsections.
* The Markdown database caches summaries by section/subsection. Cached values must be regenerated
  whenever the corresponding summarized content changes. The preview functionality makes use of cached
  summaries.

## Open Questions

### Overall

1. **Problem and audience.** What problem does this solve, and for whom? Specquer is "a tool for spec-driven development", but these ideas do not yet connect specs to code. Is a summarizing Markdown viewer a first step towards that, or the product itself?
2. **Viewer or editor.** CodeMirror implies editing, but only viewing is described. Where does Milkdown (a WYSIWYG Markdown editor, listed in the technology references) fit alongside react-markdown?
3. **First version.** The database with fragment identity is by far the hardest part. Could a first version deliver summaries and collapsing with simple content-hash caching, and add fragment identity and history later?

### Context

4. **Location of the files.** Specquer runs as a Bun server launched from a local file system. Is the documentation root the directory it is launched from, or a configured path? One repository or several?
5. **MDX.** react-markdown cannot render MDX. Rendering MDX means compiling and running code from the repository, and deciding where its imported components come from. Is MDX rendering required, or could MDX components be shown as inert placeholders at first?
6. **Frontmatter and headings.** Some documentation tools (such as Astro Starlight) treat a frontmatter `title` as the page's H1. Should a frontmatter title count as the top-level heading in the section tree?

### Markdown Database

7. **Source of truth or cache.** If everything in the database can be rebuilt from Git history, it is a disposable index. If it holds anything Git cannot rebuild (identity links, summaries), is it committed and shared with the team, or kept per machine? (`bun:sqlite` fits the single-executable architecture either way.)
8. **Revisions.** Is a revision a Git commit, or are uncommitted edits and every save tracked too? How are branches handled, given that a fragment can have different histories on different branches?
9. **Fragment granularity.** Is a fragment a section, or every block node in the Markdown syntax tree (paragraph, list item, table row)?
10. **Purpose of identity.** What is fragment identity for: history per section, summary caching, comments, traceability links to code or tests? The answer sets how good the matching must be. Caching summaries only needs "same content"; tracing a requirement needs "same requirement, reworded".
11. **Identity edge cases.** How are these handled: a section split in two or two merged into one, a fragment moved to another file, a renamed file? At what point does a modified fragment become a new one?
12. **Section edge cases.** How are these handled: content before the first heading, skipped levels (H1 directly to H3), headings inside MDX components, duplicate heading text?

### Markdown Documentation Viewer

13. **Folder pane contents.** Does the folder pane show only `.md` and `.mdx` files, or every file? Does it respect `.gitignore`?
14. **Split-view synchronization.** Synchronized scrolling needs a map from rendered elements back to source positions. Remark's syntax tree has positions, but react-markdown hides most of them. Is synchronization per section good enough?
15. **Links, images and search.** Do relative links between documents navigate within the viewer? Are images shown? Is there search?
16. **Live reload.** Does the view update when a file changes on disk, for example after an edit in another editor or a `git pull`?

### Automated Summarization

17. **Summarizing from source or from summaries.** Is a parent section summarized from its original text, or from its children's summaries? Summarizing summaries is cheaper and keeps levels consistent, but quality drops at each level. Summarizing source is more faithful but costs more and needs large context windows. Either way, a change deep in the tree invalidates every ancestor's summary.
18. **When summaries are generated.** On demand when a section is collapsed, or ahead of time in the background whenever content changes? Pre-generating summaries for a large repository means many model calls.
19. **Cost and data leaving the machine.** Each summary sends specification text to a model provider. Is summarization opt-in per repository? Whose API key is used? Does the application work offline with summaries disabled?
20. **What counts as a change.** Does fixing a typo or whitespace force regeneration? Reusing the identity algorithm's notion of a minor change would avoid needless model calls.
21. **Summary levels across documents.** The example assumes three heading levels. Are levels counted per document, or relative to the deepest heading? If one H3 is expanded under a summarized H2, does the H2's summary stay, disappear, or get regenerated?
22. **A section's own content.** When H3 sections are summarized, is the text directly under the H2 (before its first H3) still shown in full, or summarized together with its subsections?
23. **Trust signals.** Should summaries be marked as AI-generated, show when they are stale or being regenerated, and offer a one-click way to see the source?
24. **Collapse state.** Is the collapse state remembered per user and per document? Is it in the URL so that a view can be shared?
