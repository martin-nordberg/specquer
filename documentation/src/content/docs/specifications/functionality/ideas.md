---
title: Ideas
---

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
