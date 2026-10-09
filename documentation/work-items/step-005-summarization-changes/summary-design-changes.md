<a id="WORK-00175" data-uid="hk5zithc6w2e"></a>

<a id="WORK-00176" data-uid="mp594sceq7z3"></a>
# Summarization Design Changes

<a id="WORK-00177" data-uid="fusa438lgxot"></a>
## Concerns

1. It is planned to use AI section summaries for other purposes in the future:
   * As hoverable previews for links to section anchors
   * In secondary, generated reports such as work in progress, traceability matrices, etc.
   * Maybe in project management aids such as a simple story board.

2. Summarization is quite slow.

3. Given the slowness, it seems like a 30 day limit on the cache was too aggressive.

<a id="WORK-00178" data-uid="jbrxzx5wgtb6"></a>
## Ideas

* When a section is too short to deserve a summary, there is no cached summary.
  However, the new functionality would be simpler if it always retrieves from
  cache to the extent available and otherwise does without. This suggests caching
  a plain text "summary" of the section content.
* Based upon a configuration toggle, let the server perform summarization
  tasks in the background to fill in missing cache entries for all known sections.
* Scrap the time-limited cache logic. Instead track the section ID along with
  the section content hash code. Clear out any old cache entry for a section
  whose hash code has changed. Combined with background cache pre-filling this
  should leve no obsolete cache entries. Ensure cache entries are keyed to
  precise model version.
* When a cache entry is not available for the current model, look for entries
  for other models. Use the other-model entry that is newest. Show the model
  name next to "AI Summary" in the UI.
* Establish two tiers of model use: one simpler, faster model for quicker responses
  and a second slower, better model for improved summaries after some delay.
  Use the better model for background cache pre-filling.

<a id="WORK-00179" data-uid="j528g3b1il1q"></a>
## Feedback

_Review notes from October 2026, against the current code (`../../../server/src/summaries`, `agent/src/summarize.ts`, `shared/src/summaries/rules.ts`)._

<a id="WORK-00180" data-uid="vly9dnc43ynx"></a>
### The Change Underneath: Summaries by Section, Not by Text

Every future use in concern 1 (link previews, reports, a story board) asks "what is the summary of `SPEC-00123`?". Today the client sends the section's text to `POST /api/summaries`, and the server never reads files ([security](/specifications/security) §"What is sent"). Looking a summary up by section ID, and background pre-filling, both need the server to read the section's text itself, through `SectionIndex`. That is the real design change. It needs a security spec update: the provider would then receive sections the user never opened.

<a id="WORK-00181" data-uid="bjlwg084nobx"></a>
### Concerns

- **Concern 1:** a link preview probably wants one or two sentences, but the sentence count follows the section's length and is part of the cache key. Decide whether previews use the stored summary as it is, its first sentence, or a separate short summary (another call per section).
- **Concern 2:** measure before choosing a remedy. A long document runs many calls, each waiting for its subsections' summaries (`summarizeWithFallback`), with a concurrency of 2 on a free-tier 31B model. Logging queue wait time separately from model latency would show whether concurrency, the model or the call structure is the bottleneck.
- **Concern 3:** agreed. Keys are content hashes, so a stale summary is never served. The 30-day limit (decision D8) only stops the database from growing, and garbage collection can do that better (below).

<a id="WORK-00182" data-uid="dzeht8h5nq8c"></a>
### Ideas

- **Caching short sections' text:** the uniformity is worth having, but in the lookup function rather than in the database. `isShortSection` is deterministic and costs microseconds, so a `summaryFor(section)` that returns the text of a short section gives callers "always ask, sometimes get nothing" without copying spec text into the cache or invalidating it. Note that short sections are returned as simplified Markdown, not plain text; a hover preview would need the Markdown stripped.
- **Background pre-filling:**
  - **Opt-in and off by default:** it sends every spec to the provider, not just the ones being read.
  - **Interactive requests first:** `CallQueue` is first in, first out, so it needs priorities, or a slider request would wait behind the whole backlog.
  - **Bottom up:** fill subsections before parents. That matches the fallback, and a parent's call can then reuse its children's cached summaries.
  - **When it runs:** after a scan or a save, debounced. It pauses on a 429 and backs off, rather than reporting each one to the user.
- **Keying by section ID plus hash, deleting on change:** keep the content hash as the key and add the section ID as a reference, rather than replacing it. Text keys share summaries between identical text, and they cover text that has no ID: whole documents, preambles, sections with empty anchors and the fallback's parts. Deleting an entry as soon as its section's hash changes also hurts in two cases. Switching Git branches and back would throw away summaries you want again, and undoing an edit would mean a new call. A suggestion:
  - A table from section ID to content key, rewritten after each scan.
  - Garbage collection that deletes entries no current section refers to, once they have been unreferenced for some days or past a size cap. That is a time limit again, but only for orphaned entries.
  - On "precise model version": the key holds `config.name` (`google/gemma-4-31b-it`). Adding the provider and `baseUrl` would separate the same name on different hosts. A provider that changes the weights behind a name can't be detected either way.
  - Typo: "leve" should be "leave".
- **Falling back to other models' entries:** the key would have to split in two. The lookup part would be the text hash, the sentence count and the prompt version; the model would become a column. Prefer entries by a configured rank (the better tier first) rather than by age: "newest" can pick a fast-model summary over a better one. Entries from older prompt versions could take part in the same way, ranked last. Showing the model name next to "AI summary" is a good idea in any case.
- **Two tiers of models:** this is "stale while revalidate": the fast model answers now, and the better one replaces its answer later. Things to settle:
  - It doubles calls for each section that is new or changed.
  - A summary changing while someone reads it needs a quiet hint in the UI, not a jump.
  - `agent.config.yaml` gains a list of models with roles, which the personal file must still be able to override.
  
  With background pre-filling by the better model, the fast tier only matters for sections that have just been edited, and for the first time a repository is opened. Try pre-filling with one model first, and add the second tier only if edited sections still feel slow.

<a id="WORK-00183" data-uid="d2dwe0ujj64r"></a>
### Suggested Order

1. Split the cache key, and identify models by provider, name and URL. Replace the 30-day expiry with deleting entries unused for 60 days. No table from section IDs to entries is needed: the lookup finds a section's entry from its file, and pre-filling marks the entries still in use.
2. Server-side lookup by section ID, from the cache only and never calling a model, with short sections answered as written. The server and the preview share the list of sections the slider can summarize, so their cache keys match.
3. Background pre-filling, off by default, with queue priorities. Update the security spec.
4. Show the model name; fall back to other models' entries, then replace them with the configured model's summary.
5. Two tiers, if measurements still call for it.

Steps 1 to 4 are planned in the [Step 005 implementation plan](implementation-plan.md).
