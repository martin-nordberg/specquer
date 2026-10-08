<a id="WORK-00001" data-uid="n8w0w4eq2ka6"></a>

<a id="WORK-00002" data-uid="o2v741k9khzq"></a>
# Step 004 - Implementation Plan

_Plan for [Step 004 requirements](requirements.md): hierarchical summarization in the preview.
Drafted October 2026._

<a id="WORK-00003" data-uid="xtceoclpcwlw"></a>
## 1. Summary

Step 004 adds a slider above the preview that replaces sections, level by level, with AI
summaries, down to one summary of the whole document. It is Specquer's first AI feature:

- **`shared`** gets a section outline of a body (heading sections with their levels and source
  ranges), the slider's stops, and the text simplification and length rule for summaries.
- **`agent`**, until now a placeholder, gets its first LangChain code: the configuration, a chat
  model for NVIDIA's hosted models, and the summarization prompt with its fallback for long
  sections.
- **`server`** gets the summary service: the configuration files, a SQLite cache in
  `.specquer/cache/summaries.db` (30 days), a queue that limits and deduplicates model calls,
  and two routes.
- **`client`** gets the slider, the summarized preview, the summary states ("Summarizing...", out
  of date, error), summaries that follow saves, the slider position in the UI state, and a
  **Save now** button in place of "Unsaved changes".

There are seven phases (§5). Phase 0 checks the NVIDIA connection and the cost of the full-text
approach before anything is built on them. Decisions taken while planning are in §6, marked
_Proposed_; the work proceeds on them unless they are changed. §7 records the author's answers to
the questions raised while planning.

<a id="WORK-00004" data-uid="ai2jdear4jci"></a>
## 2. Precedence

Step 004 takes precedence over the specifications where they conflict:

| Topic | Before | Step 004 (wins) |
|---|---|---|
| Network | The server makes no outbound calls | With a model configured, the server sends section text to the model provider ([Security](/specifications/security)) |
| `.specquer/` | `shared/` (committed) and `user/` (ignored) | Also `cache/` (ignored, with its own `.gitignore`), `shared/agent.config.yaml` and `user/agent.config.yaml` |
| UI state | Per file: view type, front matter height | Also the slider position |
| Save status | Plain text | "Unsaved changes" is a button that saves now ([client requirements](/specifications/client-requirements) §7) |
| `agent` | A placeholder | Summarization |
| Preview | Always the full text | Sections may be replaced by summaries |

<a id="WORK-00005" data-uid="m0o1l4z5neow"></a>
## 3. Starting Point

- **Preview** (`client/src/components/Preview.tsx`): the body goes to a Web Worker (`client/src/preview/preview-worker.ts`), which returns the hast tree of `markdownToHast`; the main thread renders it with `hast-util-to-jsx-runtime` and a component map (links, section badges). The hast elements keep their source positions, and the worker's structured clone keeps them too.
- **Sections** (`shared/src/markdown/sections.ts`): `analyzeBody` finds the top-level headings with their depths and titles, but not the ranges they cover; the Markdown domain's scope table already names "the heading and section tree (for collapsible sections and summaries)" as later work.
- **UI state** (`shared/src/uistate/`): `fileUiStateSchema` holds `viewType` and `frontmatterHeight` per file, each parsed on its own so a damaged field falls back alone.
- **Agent** (`agent/`): `langchain` 1.5.15 and `@langchain/core` 1.2.14 are installed; `src/index.ts` is empty. `@langchain/core/utils/testing` has `FakeListChatModel` for tests. `@langchain/openai` 1.6.2 (peer `@langchain/core` ^1.2.14) matches. `langchain`'s `initChatModel` has no NVIDIA entry.
- **UI components:** no Slider yet in `client/src/components/ui`; `radix-ui` is installed.
- **SQLite:** not used yet. The [Database Choice](/notes/database-choice) note chose `bun:sqlite`.

<a id="WORK-00006" data-uid="u2adr62oja6a"></a>
## 4. Proposed Design

<a id="WORK-00007" data-uid="fhgzysiecoz0"></a>
### 4.1 Outline (`shared/src/markdown/outline.ts`)

```ts
interface OutlineSection {
  depth: number;          // 1 to 6
  title: string;
  /** The heading's own range, and the section's: from the heading (or its anchor line) to the next heading of the same or a higher level. */
  heading: Range;
  range: Range;
  /** The text before the first subsection. */
  lead: Range;
  children: OutlineSection[];
}
interface Outline { preamble: Range; sections: OutlineSection[]; levels: number[] }  // levels: depths used, ascending
```

- Built from the same `remark-parse` tree as `analyzeBody`, so only top-level headings count (not those in block quotes or lists), as in Step 002. A heading's section anchor on the line before it belongs to its section's range.
- **Stops** (`summaryStops(outline)`): `levels.length + 2` stops, or none when there are no headings. Stop `m + 1` is the full text; stop `k` (1 to `m`) summarizes the sections at depth `levels[k - 1]`; stop 0 summarizes the whole document, preamble included (front matter is never part of the body).
- **What a stop shows** (`summarizedAt(outline, stop)`): the sections to summarize, each with its range, the headings above it (for the prompt) and an **outline path** (the indexes of the section and its ancestors, such as `1.0.2`), which identifies a section across edits (§4.6).

<a id="WORK-00008" data-uid="t76oclm9wx25"></a>
### 4.2 Summary Rules (`shared/src/summaries/`)

- `simplifySectionText(text)`: CRLF to LF, trailing whitespace removed from each line, runs of blank lines collapsed, section anchors (`<a id="…" …></a>` in section positions and strays alike) removed, leading and trailing whitespace removed.
- `wordCount(text)`, `SHORT_SECTION_WORDS = 60` (shown as written), `targetSentences(words)` = `clamp(round(words / 150), 2, 10)`.
- The request and response schemas for the API (§4.5).

<a id="WORK-00009" data-uid="q3o8rcn3dqy9"></a>
### 4.3 Agent (`agent/src/`)

- **Configuration** (`config.ts`): a Zod schema and `mergeAgentConfig(shared, user)`:

  ```yaml
  # .specquer/shared/agent.config.yaml
  model:
    provider: nvidia
    name: <model ID from NVIDIA's current list, chosen in Phase 0>
    baseUrl: https://integrate.api.nvidia.com/v1   # the default for nvidia
    apiKeyEnv: NVIDIA_API_KEY
  summaries:
    concurrency: 2
    tokenBudget: 24000
  ```

  The user file overrides key by key; a `model:` in it replaces the shared `model:` as a whole (D7). Unknown keys are ignored and invalid values reported, as for the prefix configuration. `provider` accepts only `nvidia` in this step.
- **Model** (`model.ts`): `createChatModel(config, env)` returns `ChatOpenAI` from `@langchain/openai`, pointed at `baseUrl` with the key from `env[apiKeyEnv]`, a low temperature, and a timeout. Without a key it reports "not configured". Later providers come through `initChatModel("provider:model")` and their packages; the factory is the only place that changes.
- **Summarizing** (`summarize.ts`): `summarizeSection(model, input, { signal })`, where `input` is the simplified text, the file name, the headings above the section and the target sentence count. A single prompt (`PROMPT_VERSION = 1`) asks for plain prose, no Markdown, no headings, in the language of the text. The output is trimmed and Markdown markers are stripped.
- **Long sections:** when the estimated tokens (characters / 4) exceed `tokenBudget`, the section is summarized from its subsections' summaries (each found, or computed, through the same cache), then the heading and lead text with those summaries. A section with no subsections that is still too long is cut at the budget, which the summary's label says.
- LangSmith tracing stays off; nothing sets `LANGSMITH_*`.

<a id="WORK-00010" data-uid="ftwizq1i4u5l"></a>
### 4.4 Server (`server/src/summaries/`)

- **Configuration file** (`config.ts`): reads both `agent.config.yaml` files with the `yaml` package and reads them again when their modification times change, like `PrefixConfigFile`. Keys come from the server process's environment. Bun loads `.env` from its working directory, which the docs point out.
- **Cache** (`cache.ts`): `bun:sqlite`, WAL mode, at `.specquer/cache/summaries.db`. Creating `.specquer/cache/` also creates its `.gitignore` containing `*`.

  ```sql
  CREATE TABLE summaries (key TEXT PRIMARY KEY, model TEXT, prompt_version INTEGER, summary TEXT, truncated INTEGER, created_at INTEGER);
  ```

  `key` = SHA-256 of the simplified text, the model ID, the prompt version and the target sentence count. Rows older than 30 days are ignored when read and deleted at startup and once a day (D8). An unreadable database is moved aside and created again; the cache never stops the server.
- **Queue** (`queue.ts`): at most `concurrency` model calls at once; requests with the same key share one call; a call whose requests were all aborted is dropped if it hasn't started, and aborted (LangChain's `signal`) if it has.
- **Service** (`service.ts`): `status()` (enabled, model name) and `summarize(request, signal)`: short sections come back as written, cached summaries at once, the rest through the queue.
- **Errors:** not configured (`503 not_configured`), the provider's rate limit (`429`), other provider or network failures (`502`, with the provider's message), all as the usual JSON error body.

<a id="WORK-00011" data-uid="dq1v94zcqfvq"></a>
### 4.5 API (`shared/src/api`)

| Route | Body and response |
|---|---|
| `GET /api/summaries/status` | `{ enabled, model? }` |
| `POST /api/summaries` | `{ path, text, headings }` → `{ summary, model, cached, truncated }`; `text` at most 1 MB. The client aborts the request when the summary is no longer needed |

The client sends the **saved** text of each section, taken from the text `DocumentStore` last read or wrote, never unsaved edits; the server doesn't read files for summaries.

<a id="WORK-00012" data-uid="plqyobxqhi92"></a>
### 4.6 Client

- **Slider** (`client/src/components/ui/slider.tsx`): the shadcn Slider, hand-copied, on `radix-ui`'s Slider.
- **Summary control** (`SummaryControl.tsx`): above the preview in the split and preview views, with the current stop's name beside it ("Full text", "Summarize level 3 sections", …, "Summarize document"). Hidden for a document without headings; disabled, with a hint naming `.specquer/shared/agent.config.yaml`, when the status says summarization isn't enabled.
- **The summarized preview** (D1): the preview renders the whole body as now, then, for the current stop, filters the hast tree's top-level children by their source offsets. A summarized section keeps its heading element (except at stop 0) and the rest of its range is replaced by one `specquer-summary` element that the component map renders as `SectionSummary`. Rendering once keeps reference links, footnotes and badges working; sections shown as written (under 60 words) aren't filtered.
- **`SectionSummary`:** "Summarizing..." while waiting; the summary as plain text paragraphs (D2) with a subtle "AI summary" label (and "shortened" when truncated); "out of date" on the label while its section has unsaved changes; an error with **Retry**. Clicking it moves the slider to the full text and scrolls to its heading.
- **Requests** (`summaries.ts`, a small store): summaries are requested for the outline of the saved body; the preview shows the outline of the current body. A summarized section whose current text differs from its saved text (matched by outline path, D5) keeps its summary, marked out of date; after each save, the store requests the sections whose saved text changed. `DocumentStore` exposes the saved body for this. Results are kept in memory by simplified text, so moving the slider back and forth makes no requests. Changing the stop or the file aborts requests no longer needed.
- **Save now** (`App.tsx`): while the status is "Unsaved changes", it is a button (accessible name "Unsaved changes: save now") that calls `DocumentStore.save()`; in every other state it stays plain text, as now.
- **Links and scrolling:** when a scroll target (a link to a section, or a click on a summary) isn't in the rendered tree, the preview moves the slider to the full text, then scrolls. Headings get a `data-outline-path` attribute so sections without anchors can be scrolled to.
- **UI state:** `files[path].summaryStop`, stored as steps from the full text (0 = full text), clamped to the document's stops when it has fewer (D3). `setSummaryStop` joins the update functions; the UI state version stays 1, since the field is optional and parsed on its own.

<a id="WORK-00013" data-uid="fvux7h3qx3l6"></a>
### 4.7 Security

- Summarization is opt-in: without a model and its key, no request leaves the machine, and `POST /api/summaries` answers `503`.
- The summary route takes text only from the authenticated client (session token, Host and Origin checks, as for every API route) and never reads files.
- Model output is rendered as text only, never as HTML.
- The Security specification gets a section covering the provider seeing section text, keys in the environment and never in configuration files, the free tier's terms, and the cache's location.

<a id="WORK-00014" data-uid="a7ge7grquns8"></a>
## 5. Phases

Each phase lists its tasks and what "done" means. Tests are written within each phase.

<a id="WORK-00015" data-uid="td08zjw806lh"></a>
### Phase 0 - Spikes

1. **NVIDIA through `@langchain/openai`.** Add `@langchain/openai` to `agent`, check `ChatOpenAI`'s options in the installed types (CLAUDE.md: check the installed API), choose a suitable model from NVIDIA's current model list (not from memory), and make one call with the key the author configures in `NVIDIA_API_KEY`. *Done when* a summary of one of this repository's specs comes back, its latency is known, and the free tier's terms have been read and noted.
2. **Cost of the full-text approach.** Count the characters (and estimated tokens) each stop sends for this repository's specs, without calling a model. *Done when* the numbers are in the implementation status and `tokenBudget`'s default is confirmed or changed.
3. **Filtering hast by position** (D1). Check that the top-level hast children keep offsets that match the outline, including after `rehypeSectionAnchors` moves a heading's anchor into the heading. *Done when* a test filters a rendered document at every stop.
4. **`bun:sqlite` in the release build.** *Done when* the compiled executable creates and reads the cache.

<a id="WORK-00016" data-uid="ynmajqe0co9i"></a>
### Phase 1 - Outline and Rules (`shared`)

- `outline.ts`, `summaryStops`, `summarizedAt`; `shared/src/summaries/` with the simplification, word count and length rule; the API schemas; `summaryStop` in the UI state with `setSummaryStop`.
- Tests: outlines with skipped and unused levels, a document starting at h2, a preamble, headings in block quotes and lists ignored, anchors on the line before a heading, CRLF; stops and what each shows; simplification; the length rule; the UI state field's parsing and clamping.
- *Done when* `bun test shared` and the type-check pass.

<a id="WORK-00017" data-uid="ebhm9q9r1hp2"></a>
### Phase 2 - Agent

- `config.ts` (schema, merge), `model.ts`, `summarize.ts` (prompt, plain-text output, the long-section fallback, truncation).
- Tests with `FakeListChatModel`: the prompt carries the file name, the headings and the sentence count; Markdown is stripped from the output; the fallback summarizes subsections first; the abort signal is passed on.
- *Done when* `bun test agent` passes without network access.

<a id="WORK-00018" data-uid="fpp62baqevsv"></a>
### Phase 3 - Server

- The configuration file, the cache, the queue, the service and the two routes.
- Tests: the user file overrides the shared one; not configured; cached summaries make no model call; rows older than 30 days are ignored and purged (with an injected clock); a damaged database is recreated; the `.gitignore` is created; concurrency is limited; identical requests share a call; an aborted request is dropped; provider errors map to `429` and `502`.
- *Done when* the API tests pass with a fake model.

<a id="WORK-00019" data-uid="c6cd9xslcq5s"></a>
### Phase 4 - Client

- The Slider, `SummaryControl`, hast filtering, `SectionSummary`, the request store following saves, the **Save now** button, links and clicks to the full text, the UI state field.
- Component tests: the control's stops and names, hidden without headings, disabled when not enabled; the filtered preview at each stop; the summary states; out of date while unsaved and requested again after a save, with no request for unsaved text; the save status as a button only while there are unsaved changes; aborting when the stop changes.
- End-to-end tests (`e2e/summaries.spec.ts`) against a small fake OpenAI-compatible server the fixture starts (D9), with `agent.config.yaml` pointing at it. They cover:
  - moving the slider through every stop
  - the position kept after a reload
  - "Summarizing..." then the summary
  - an error and **Retry**
  - a link into a summarized section showing the full text
  - typing in the split view marking a summary out of date, and **Save now** updating it
- *Done when* the end-to-end tests pass on Chrome and WebKit.

<a id="WORK-00020" data-uid="kxmpzk9mqkee"></a>
### Phase 5 - Documentation

- Link the requirements and this plan in the VitePress sidebar (done while planning).
- **[Data Architecture](/specifications/data-architecture):** §1 gets the outline and stops (the scope table's "later" item); a new §4, **Summaries**, covers the rules, the cache, the agent configuration and the request flow; §3 adds `summaryStop`.
- **[Client Requirements](/specifications/client-requirements):** the slider, summaries and their states, and the **Save now** button in the save status (§7).
- **[Server Requirements](/specifications/server-requirements):** the summary routes and their errors.
- **[Information Architecture](/specifications/info-architecture):** `.specquer/cache/` and the two `agent.config.yaml` files in the folder layout; the Summary concept.
- **[Security](/specifications/security):** the new section from §4.7.
- **[Technical Architecture](/specifications/technical-architecture):** `bun:sqlite`, `@langchain/openai`, the agent package's role, and the request flow.
- `CLAUDE.md`: the agent package is no longer a placeholder, the server's `summaries/` module, and how to give Specquer a key for development.
- A Step 004 implementation status section at the end of this plan.

<a id="WORK-00021" data-uid="hmung7bh6ji3"></a>
### Phase 6 - Review on Real Specs

- Run the slider over this repository's specs with the configured NVIDIA model, check the summaries' quality and the length rule, and adjust the prompt (raising `PROMPT_VERSION`).
- *Done when* the author has reviewed summaries at every stop for two or three specs.

<a id="WORK-00022" data-uid="mqpsewvg9tej"></a>
## 6. Decision Points

Taken while planning; each is _Proposed_ and the work proceeds on it unless changed.

- **D1. How summaries enter the preview.** _Proposed:_ render the whole body, then filter the hast tree's top-level children by source offsets and insert summary elements. Rendering each kept part separately would break reference links and footnotes defined elsewhere in the document.
- **D2. Summary format.** _Proposed:_ plain text paragraphs. Rendering the model's Markdown would need the sanitizer and invites injected links; plain prose is what the requirements ask for.
- **D3. Storing the slider position.** _Proposed:_ steps from the full text (0 = full text), clamped to the stops the document has, so adding a heading level doesn't silently change what an existing position shows at the left end.
- **D4. Requests.** _Proposed:_ one request per section, so each can be aborted and cached on its own; the server limits concurrency (default 2) and shares identical requests.
- **D5. A section across edits.** _Proposed:_ the outline path (section indexes from the top) identifies "the same section" for marking a summary out of date; renaming a heading keeps the path, inserting a section before it shifts it, in which case the summary is simply requested again after the next save.
- **D6. Token estimate.** _Proposed:_ characters / 4, with a default budget of 24,000 tokens, revisited after Phase 0 against the chosen model's context window.
- **D7. Merging the configuration.** _Proposed:_ the user file overrides key by key under `summaries:`, and replaces `model:` as a whole, since a model's name, URL and key variable belong together.
- **D8. Expiry.** _Proposed:_ by creation time, 30 days whether used or not (requirements); rows are ignored past that when read, and deleted at startup and once a day.
- **D9. End-to-end tests.** _Proposed:_ a fake OpenAI-compatible server started by the test fixture, so tests never call a real model and need no key.
- **D10. Status.** _Proposed:_ the client asks `GET /api/summaries/status` once per page load and after each focus of the tab, so editing the configuration takes effect without a restart.

<a id="WORK-00023" data-uid="ul78x28yinix"></a>
## 7. Questions Answered

1. **A key for Phase 0.** The author configures `NVIDIA_API_KEY`; Phase 0 chooses a suitable model to start with.
2. **Unsaved text.** Unsaved text is never sent: summaries follow saves (§4.5, §4.6), and the requirements change accordingly. To make saving quick, "Unsaved changes" in the save status becomes a button that saves now; the status stays plain text when there is nothing to save.

<a id="WORK-00024" data-uid="h6vu0jxlvdib"></a>
## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The free tier's rate limits | Slow or failing summaries at the far-left stops | Concurrency limit, shared requests, cache; the error state offers **Retry** |
| Cost of full-text summaries | Each level resends its subsections' text | Phase 0 measurement; token budget with the fallback |
| Weak summaries from the chosen model | The feature isn't useful | Phase 6 review; switching models is a configuration change |
| Prompt injection in specs | Misleading summaries, injected links | Plain text output; summaries labeled as AI-generated, one click from the source |
| Hast positions shift with future pipeline steps | Wrong parts hidden | Phase 0 test of filtering at every stop, kept as a regression test |
| Keys in the wrong place | A key committed to Git | The configuration only names the variable; the docs say so |

<a id="WORK-00025" data-uid="nznpgck88xig"></a>
## 9. Implementation Status

Phases 0 to 5 were carried out in October 2026; Phase 6 awaits the author's review. What differs from the plan, or was learned doing it:

1. **The model (Phase 0).** `@langchain/openai` 1.6.2 works against NVIDIA's API with `configuration.baseURL`. Of the models NVIDIA listed, several answered 404 for this account (listed isn't callable), two timed out, and the reasoning models spent tokens thinking (one wrote its whole thought process as the answer). `google/gemma-4-31b-it` keeps to the sentence count, writes plain prose and doesn't reason: about 3 to 5 s for a section, 24 s for all of `data-architecture.md` (7,800 input tokens). It is configured in this repository's `.specquer/shared/agent.config.yaml`.
2. **Free tier.** NVIDIA's API catalog is a trial service under the NVIDIA API Trial Terms of Service, for evaluation and prototyping, with each model under its own license; the rate limit is about 40 requests a minute per account and varies with load. This is in [Security](/specifications/security) §9.
3. **Cost (Phase 0).** For this repository's seven specs, every stop of every spec sends about 74,000 tokens in all. The largest single call is about 7,500 tokens (`data-architecture.md` at stops 0 and 1), so the default token budget of 24,000 stays and the fallback isn't needed here. A spec with one h1 sends nearly the same text at stops 1 and 0; after simplification it is identical, so the two share one cache entry.
4. **Filtering by position (Phase 0, D1)** works as planned, including headings whose anchors the pipeline moves into them, setext headings, a byte-order mark and footnotes; `outline.test.ts` filters a rendered document at every stop. At stop 0, generated content (the footnotes section) goes too.
5. **Deeper sections at a stop.** With skipped levels, a stop summarizes every section at its level *or deeper* that isn't inside one already summarized, so an h3 directly under an h1 is summarized at the h2 stop.
6. **Unsaved new sections.** A section with no saved counterpart at its outline path is shown as written until it is saved, rather than as "Summarizing...".
7. **The long-section fallback** is orchestrated in `agent` (`summarizeWithFallback`), with the server passing the cached path for subsections and the queue for model calls, so a section waiting for its subsections never holds a queue slot.
8. **Retries.** `ChatOpenAI` retries once (`maxRetries: 1`) before an error reaches the user, who can then **Retry**.
9. **A configuration race.** Two requests arriving together after a configuration change could see the old configuration; the file's parse is now shared as a promise.
10. **Status.** `GET /api/summaries/status` also returns `problem`, which the disabled slider shows as a tooltip (no model configured, or the key variable not set).
11. **`bun:sqlite` in the release build (Phase 0):** the compiled executable created `.specquer/cache/` with its `.gitignore` and the database, summarized a section of `security.md` through NVIDIA in 3 s, and answered the same request from the cache in about 1 ms.
12. **Tests.** Unit and component tests pass, and the end-to-end tests (`e2e/summaries.spec.ts`, against a fake OpenAI-compatible server) pass on Chrome and WebKit, as does the rest of the suite.
13. **Phase 6.** Summaries of `overview.md`, `security.md` and `client-requirements.md` were made at every stop with the configured model. They follow the length rule exactly and read well, so the prompt is unchanged (`PROMPT_VERSION` stays 1). Calls took 2 to 17 s each on the free tier, so the stops left of the full text fill in over seconds to a minute for a large spec. The author's own review of the summaries at every stop is still to come.
