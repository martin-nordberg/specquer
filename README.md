# Specquer

Specquer is an experimental tool for spec-driven development for AI-assisted software engineering.

Specquer focuses on editing software specifications in a structured way that mixes human
interactive editing and prompted AI agent editing.

## Currently In Place

* Typical folder and file browser left pane
* Editing of plain text Markdown files (CodeMirror)
* Preview of Markdown files processed to HTML
* Side-by-side editing and preview
* Experimental WYSIWYG editing view (needs work)
* Automated marking of document sections (hierarchal with headings) via `<a>` anchor tags
* Hierachical summarization
  - AI-generated summarization by section
  - A slider mechanism to summarize at a lower or higher level in the hierarchy
  - Caching and pre-generation of summaries
* Document-focused chat - interactive Q&A about the specifications in a repository, with answers
  citing the sections they come from

## Planned

* Distinction of specification folders as one of four types:
  - "Baseline" - specification of the current state of the entire system
  - "Change" - specification of an increment in functionality or some incremental work effort
  - "Auxiliary" - specifications that are notes, reference materials, ideas, etc. not tied
                  to the whole system nor to specific tasks
  - "Nonsectioned" - specifications not managed by Specquer
* Sidecar mechanism for tracking review comments
* Section properties like implementation status, review history, etc.
* Diff view for work in progress with added functionality for moved sections
* Requirements traceability using section anchor links
