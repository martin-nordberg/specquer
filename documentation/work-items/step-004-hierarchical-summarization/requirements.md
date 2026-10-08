# Hierarchical Summarization

_Step 004 requirements. Reviewed October 2026; the decisions taken in the review are listed at the
end._

## Context

* Summaries appear in the preview: the preview half of the split view, and the preview view.
* NOT in the text editor or the WYSIWYG editor.
* Summaries apply to heading sections. List item sections (Step 002) are summarized only as part
  of their heading's section.
* Out of scope: expanding or collapsing individual sections independently of the slider, and
  expand all / collapse all within a section (described in the Ideas note). Deferred, possibly
  for good.

## Summarization Slider Control

* A small shadcn Slider control appears above the Markdown preview.
* It has one stop per heading level the document uses, plus two: the full text and the whole
  document. Unused and skipped levels add no stops: a document with h1, h2 and h3 has 5 stops, a
  document with h2 and h3 has 4, and a document with h1 and h3 has 4.
* The stops are indexed 0 to m+1 for purposes of these requirements, where m is the number of
  heading levels used.
* The default position is all the way to the right (m+1): the preview as today, nothing
  summarized.
* Moving the slider one step to the left (m) summarizes every section at the deepest heading level
  used.
* Each further step to the left summarizes the sections of the next higher level used, which
  takes in the sections below them.
* At the far left (0), the entire document is summarized, and no headings remain.
* Each stop has an accessible name, such as "Full text", "Summarize level 3 sections", …,
  "Summarize document", and the current one is shown next to the slider.
* The slider position is remembered per file in the existing `.specquer/user/uistate.yaml`, like
  the view type.
* A document without headings shows no slider.

## What a Summary Replaces

* A summary replaces the content of its section, including all sections below it. The section's
  heading stays, with the summary under it, so the outline stays readable. At the far-left stop,
  one summary replaces the whole document, headings included.
* Text that belongs to no section being summarized stays as written: the text directly under a
  heading before its first subsection (at the stops below that heading's level), and the content
  before the first heading (at every stop but the far left).
* A section shorter than a summary would be (under 60 words, after simplification) is shown as
  written, without calling the model.
* A summary is visibly marked as AI-generated (a subtle label and style). Clicking it shows the full
  text: the slider moves to the far right and the preview scrolls to that section.
* A link to a section hidden by a summary (`other.md#SPEC-00012`) does the same: the slider moves
  to the far right and the preview scrolls to the section.

## Summarization Approach

* The summary text consists of 2 to 10 sentences of prose in proportion to the size of the
  original section: about one sentence per 150 words, at least 2 and at most 10.
* While a summary is being computed, the placeholder text "Summarizing..." is shown in its place.
* If it can't be computed (no model configured, a network failure, the provider's rate limit), an
  error shows in its place, with a way to retry.
* Before the text of a section is summarized, it is simplified:
  - Line endings become LF, trailing whitespace on each line is removed, runs of blank lines
    become one, and leading and trailing whitespace is removed, so cache keys don't depend on
    an editor's settings.
  - Section anchor tags are removed. (Later this will prevent re-summarization when metadata
    within these tags changes.)
* The prompt gives the model the document's file name and the headings above the section, as
  context.
* Summaries are computed from the entire text of the section, not by summarizing lower-level
  summaries. A section too long for one call (over the model's context window or the configured
  token budget) is summarized from its subsections' summaries instead, as a fallback. The cost
  of the full-text approach is measured while testing on this repository's specs.
* Summaries are made from the saved file only; unsaved text is never sent to the model. A
  section edited since the last save keeps its last summary, marked as out of date, and is
  summarized again once the file has been saved.
* Model calls are queued, with a small limit on how many run at once (configurable),
  deduplicated by cache key, and dropped when no longer needed (the slider moved back, another
  file opened).
* Model output is untrusted: a spec can contain text that steers the model, so a summary may
  contain Markdown, links or HTML. Summaries are rendered as text or through the same sanitizing
  preview pipeline as specs (Security §6), never as raw HTML.

## Saving

* To help bring summaries up to date, the save status "Unsaved changes" becomes a button: clicking
  it saves the file now.
* The save status stays plain text when there are no changes to save ("Saved", "Saving…", and
  the error states).

## Caching

* Once computed, the summary of a section is stored in a SQLite database (`bun:sqlite`) at
  `.specquer/cache/summaries.db`.
* The key is a hash of the simplified section text, the model ID and a prompt version, so
  changing the model or the prompt regenerates summaries.
* The summarization process checks the cache before calling the model.
* A summary older than 30 days is discarded, whether it was used or not, and computed again when
  next needed: models improve too fast to keep summaries longer.
* The cache folder is never committed: Specquer creates `.specquer/cache/.gitignore` containing
  `*` when it creates the folder, as it does for `.specquer/user/`. Summaries aren't shared
  through Git; each user's cache is their own.

## AI Model

* Summarization is the responsibility of the agent subsystem (`agent`), which runs on the server
  only. The client asks the server for summaries over the API; the server checks the cache and
  calls the model. The browser never calls a model, so the Content-Security-Policy doesn't
  change.
* LangChain.js is the framework for AI use. LangSmith tracing stays off.
* The model is configured in `.specquer/shared/agent.config.yaml`. It is meant for other agent
  features later: `model:` at the top applies to all of them, and `summaries:` holds the
  summarization settings (length rule, concurrency, token budget).
* An optional `.specquer/user/agent.config.yaml` (never committed, like the rest of
  `.specquer/user/`) overrides the shared configuration, for someone who wants their own model or
  key.
* The configuration never holds API keys, since the shared one is committed. It names the environment variable
  that holds the key (for example `apiKeyEnv: NVIDIA_API_KEY`).
* The first version supports NVIDIA's hosted open models, through their OpenAI-compatible API
  (`@langchain/openai` with a custom base URL, to be verified while planning). Switching to
  Anthropic, OpenAI or other providers later should take only a configuration change and the
  provider's LangChain package; LangChain's `initChatModel("provider:model")` is the likely
  mechanism.
* Summarization is opt-in: until a model is configured it does nothing, the slider is disabled
  with a hint, and Specquer works fully offline.
* The Security specification gets a section on summarization: the server's first outbound network
  calls, specification text sent to a third party, and the terms of use of free hosted tiers,
  which should be checked before specs are sent.

## Decisions

Taken in the October 2026 review:

1. Slider stops follow the heading levels the document uses; unused and skipped levels add no stops.
2. A summary keeps its section's heading (except at the far-left stop).
3. Summaries are made from the saved file only; a section edited since the last save shows its
   last summary, marked as out of date, until the next save. (First decided as the editor's
   text after 10 seconds without typing; changed while planning, so unsaved text never leaves
   the machine.)
4. Sections under 60 words are shown as written.
5. Long sections fall back to summarizing their subsections' summaries; the full-text approach's
   cost is measured.
6. The slider position is remembered per file in `uistate.yaml`.
7. A link into a summarized section moves the slider to the full text.
8. Per-section expanding and collapsing is deferred, possibly for good.
9. Summaries are marked as AI-generated; clicking one shows the full text.
10. The cache key includes the model ID and a prompt version.
11. Summaries aren't shared through Git.
12. API keys come from environment variables named in the configuration.
13. The first version supports NVIDIA's hosted models only.
14. `agent.config.yaml` has `model:` for all agent features and `summaries:` for these settings.
15. A document without headings shows no slider.
16. A personal `.specquer/user/agent.config.yaml` overrides the shared configuration.
17. Summaries older than 30 days are discarded, whether used or not.
18. "Unsaved changes" in the save status is a button that saves now.
19. The first model is chosen during the implementation's first spike, with the author's NVIDIA key.
