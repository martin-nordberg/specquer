<a id="WORK-00184" data-uid="og5be2z982hk"></a>

<a id="WORK-00185" data-uid="lncg20wwor1y"></a>
# Step 005 - Implementation Plan

_Plan for the [Summarization Design Changes](summary-design-changes.md), steps 1 to 4 of its
suggested order. Drafted October 2026._

<a id="WORK-00186" data-uid="rd8se7ssy1zg"></a>
## 1. Summary

Step 005 makes summaries something the rest of Specquer can rely on, not only the slider:

- **The cache** keeps summaries while they are in use instead of for 30 days, and keys them so
  that another model's summary of the same text can be found.
- **The server** can answer "what is the summary of this section?" by section ID, from the cache
  and without a model call. Short sections are answered with their text.
- **Background pre-filling**, when switched on, summarizes every section of every document while
  the server is otherwise idle, so the slider finds its summaries already made.
- **The preview** shows which model made a summary, and shows another model's summary at once
  while the configured model's is made.

The two tiers of models (step 5 of the suggested order) are left out until pre-filling has been
measured.

There are five phases (§5): one for each step, then the documentation. Decisions taken while
planning are in §6, marked _Proposed_; the work proceeds on them unless they are changed.

<a id="WORK-00187" data-uid="n9j7jrv6c1no"></a>
## 2. Precedence

Step 005 takes precedence over the specifications and Step 004 where they conflict:

| Topic | Before | Step 005 (wins) |
|---|---|---|
| Cache lifetime | 30 days from creation, whether used or not (Step 004 D8) | Until unused for 60 days (D2) |
| Cache key | Text, model name, prompt version and sentence count, hashed together | Text and sentence count hashed; model and prompt version as columns (D1) |
| Model identity | The model's name | Provider, name and base URL (D3) |
| What is sent | Only sections the user opens in the preview, sent by the client | With pre-filling on, every section of every Markdown file, read by the server ([Security](/specifications/security)) |
| Reading files | The summary route never reads files | The lookup route and pre-filling read files through `FileService` |
| Call queue | First in, first out | Interactive calls before background ones (D6) |
| Summary label | "AI summary" | "AI summary · _model_" |

<a id="WORK-00188" data-uid="pga0y08x9qnp"></a>
## 3. Starting Point

- **Cache** (`server/src/summaries/cache.ts`): one table, `summaries`, keyed by `cacheKey(text, model, promptVersion, sentences)`, a SHA-256 hash of all four. Rows carry `created_at`; `get` ignores rows older than 30 days and `purge` deletes them, at startup and at most once a day.
- **Service** (`server/src/summaries/service.ts`): short sections come back as written; otherwise the cache, then the call queue, with `summarizeWithFallback` summarizing subsections first for sections over the token budget. The model's ID is `config.name`.
- **Queue** (`server/src/summaries/queue.ts`): `CallQueue` runs at most `concurrency` calls (default 2), shares calls with the same key, drops waiting calls whose requests were all aborted, and lets started calls finish.
- **Client** (`client/src/components/Preview.tsx`, `client/src/app/summaries.ts`): the preview builds a request for each non-short section a stop summarizes (`summarizedAt` over the saved body), with the saved text and the titles of the headings above. `SummaryStore` keeps at most three requests in flight. `SummaryResult` already carries `model`, which the UI doesn't show.
- **Sections** (`server/src/sections/section-index.ts`): `SectionIndex` knows each sectioned document's sections and their anchors (`FoundSection.anchor`), but not the ranges of text they cover. The outline (`shared/src/markdown/outline.ts`) has the ranges, but not the section IDs.
- **Files:** `FileService.listMarkdownFiles()` lists the Markdown files the tree shows.

<a id="WORK-00189" data-uid="dk5c3idmeit2"></a>
## 4. Proposed Design

<a id="WORK-00190" data-uid="mir1m97kcri0"></a>
### 4.1 Summary Targets (`shared/src/summaries/`)

`summaryTargets(body)` returns every section any stop of the slider summarizes: the union of `summarizedAt` over all stops, without duplicates, each with its outline path, range, the titles of the headings above it, and its depth. Pre-filling and the lookup route both use it, and the preview's requests are built from the same ranges, so a summary made in the background has exactly the cache key the slider asks for. A test checks that every request the preview makes at every stop is among the targets.

<a id="WORK-00191" data-uid="g92wsdce8g27"></a>
### 4.2 Cache (`server/src/summaries/cache.ts`)

- **Schema.** `summaries (text_key, model, prompt_version, summary, truncated, created_at, used_at)`, with the primary key `(text_key, model, prompt_version)`. `text_key` hashes the simplified text and the sentence count only (D1).
- **Old databases.** `PRAGMA user_version` records the schema. A database with an older version has its table dropped and created again: it is a cache, and Step 004's keys can't be split (D4).
- **Use.** `get` and `put` set `used_at`. Pre-filling also sets it on every entry a current section still needs, whether it was read or not (D2).
- **Clean-up.** `purge` deletes rows whose `used_at` is more than 60 days old, at startup and at most once a day, as now.
- **Fallback lookup** (Phase 4). `best(textKey, model, promptVersion)` returns the row for the configured model and prompt version if there is one; otherwise the newest row with the same prompt version from another model; otherwise the newest row from an older prompt version. The result says which it is.

<a id="WORK-00192" data-uid="fv2kjuwdusek"></a>
### 4.3 Model Identity (`agent/src/model.ts`)

`ResolvedModel` gains `key`: `provider:name@baseUrl`, used in the cache. `id` stays the name, shown in the UI. The same name at another host (a local server, another provider's catalog) then gets its own summaries.

<a id="WORK-00193" data-uid="t2b6tad3mymy"></a>
### 4.4 Lookup by Section (`server/src/summaries/lookup.ts`)

`SummaryService.forSection(id)` finds the section's document through a new `SectionIndex.locate(id)`, reads the file and builds the outline of its body. It then picks the outline section whose heading range holds the section's anchor, or the whole document for a document's root section. The answer comes from the cache only, never from a model call:

- `{ kind: "text", text }` for a short section or a list item, as written
- `{ kind: "summary", summary, model, truncated, current }` from the cache (`current` is false for another model's entry, from Phase 4)
- `{ kind: "none" }` when there is no summary yet
- `404` for an unknown ID

The route is `GET /api/summaries/sections/:id`, with the same session token, Host and Origin checks as every API route. It sends nothing to a provider, so it works with summaries disabled, answering from whatever the cache holds. Nothing in the UI calls it in this step; link previews and reports will.

<a id="WORK-00194" data-uid="px4omgd4il2h"></a>
### 4.5 Background Pre-filling (`server/src/summaries/prefill.ts`)

- **Opt-in.** `summaries.prefill: false` in `agent.config.yaml`; the personal file can switch it on (key by key under `summaries:`, Step 004 D7). It runs only with a model configured and its key set.
- **A pass.** For each Markdown file from `listMarkdownFiles()`: read it, take its `summaryTargets`, skip short sections, mark the cached ones used, and queue the rest. Within a file, deeper sections go first, so a long section's fallback finds its subsections' summaries cached. Files go in tree order.
- **When.** A pass starts 10 seconds after startup, and 10 seconds after the last save, create, rename or delete. A scan that finds changed files (a pull, a branch switch) also starts one. A pass already running restarts from the first file; files whose stamps haven't changed since the last complete pass are skipped.
- **Rate limits.** A 429 pauses pre-filling for one minute, doubling to at most 15. Interactive requests still report their own 429s as now.
- **Stopping.** A configuration change (prefill off, another model) aborts calls not yet started and starts a new pass if prefill is still on.
- **Status.** `GET /api/summaries/status` gains `prefill: { enabled, pending }`. The UI doesn't show it in this step; it is there for tests and for checking progress by hand.

<a id="WORK-00195" data-uid="ykpcq3b3jiug"></a>
### 4.6 Queue Priorities (`server/src/summaries/queue.ts`)

`run(key, task, signal, priority)` with `"interactive"` (the default) or `"background"`. Waiting interactive calls start before waiting background ones, and background calls use at most `concurrency - 1` slots (at least one), so a slider request never waits for more than the calls already running. An interactive request that joins a waiting background call promotes it.

<a id="WORK-00196" data-uid="u1h8tt577g88"></a>
### 4.7 Model Name and Fallback in the Preview

- **Label.** `SectionSummary` shows "AI summary · gemma-4-31b-it" (the name after the last `/`, the full ID in a tooltip).
- **Another model's summary.** `POST /api/summaries` takes `accept: "current" | "any"` (default `"current"`, as now). With `"any"`, a cached summary from another model or prompt version is returned at once with `current: false`. `SummaryStore` asks with `"any"` first. When the answer isn't current, it shows it, marked "older model", and asks again with `"current"`, after the requests the preview still needs. That second request counts toward the three in flight. When its answer arrives, the summary is replaced in place without moving the text around it (the box keeps its height until the new text renders).

<a id="WORK-00197" data-uid="ckvi0klo18rs"></a>
### 4.8 Security

- The Security specification's summaries section says what pre-filling sends (every section of every Markdown file in the tree, once per change), that it is off unless switched on, and that the server reads files for it and for the lookup route.
- The lookup route reads only files inside the root folder through `FileService`, like every other route, and never calls a model.
- Summaries stay plain text in every new place they appear.

<a id="WORK-00198" data-uid="eooswmb5yjxt"></a>
## 5. Phases

Each phase lists its tasks and what "done" means. Tests are written within each phase.

<a id="WORK-00199" data-uid="jn4z02od2v9z"></a>
### Phase 1 - Cache Key and Clean-up

- `cache.ts`: the new schema, `user_version`, `used_at`, purge by last use; `model.ts`: `key`; the service uses `key` in the cache and `id` in results.
- Tests (with an injected clock): an entry used within 60 days survives a purge, one unused for longer goes; reading an entry refreshes it; a Step 004 database is replaced, not misread; two models with the same name at different URLs don't share entries; a damaged database is still moved aside.
- *Done when* the server tests and the end-to-end summary tests pass.

<a id="WORK-00200" data-uid="zn1q19bzfjqd"></a>
### Phase 2 - Lookup by Section

- `summaryTargets` in `shared`; the preview's requests built from it; `SectionIndex.locate`; `lookup.ts`; the route and its schema in `shared/src/api`.
- Tests: targets cover every stop's requests; a heading section, a list item, a document's root section, a short section, a section with no summary, an unknown ID; a section whose anchor sits on the line before its heading; the route answers with summaries disabled and never calls the model.
- *Done when* the API tests pass, and a summary made through the slider is returned by the lookup route for the same section's ID.

<a id="WORK-00201" data-uid="eozxixi733qx"></a>
### Phase 3 - Background Pre-filling

- `prefill.ts`, the configuration key, queue priorities, the status field, the triggers (startup, file changes through the handlers, scans that find changes).
- Tests (fake model, injected clock): nothing happens with prefill off or without a key; a pass summarizes deeper sections before their parents; cached entries are marked used and not summarized again; an interactive request overtakes a queued background backlog and never waits for more than the running calls; a 429 pauses and backs off; a save restarts the pass; turning prefill off stops waiting calls.
- An end-to-end test: with prefill on and the fake model server, open a document after the pass and move the slider to every stop with no "Summarizing..." shown.
- *Done when* those tests pass and a pass over this repository with the NVIDIA model finishes without 429s reaching the user. Record its duration and number of calls in §8.

<a id="WORK-00202" data-uid="aed8j5jz260k"></a>
### Phase 4 - Model Name and Fallback

- `best` in the cache, `accept` in the request schema, `current` in the result, the label, the "older model" mark and the second request in `SummaryStore`.
- Component tests: the label shows the short name with the full ID as a tooltip; another model's summary is shown, marked, and replaced when the current one arrives; the second request waits behind the needed ones; an error on the second request keeps the older summary and shows **Retry**.
- An end-to-end test: summarize with one fake model, switch `agent.config.yaml` to another, reload, and see the first model's summary at once, then the second's.
- *Done when* the component and end-to-end tests pass on Chrome and WebKit.

<a id="WORK-00203" data-uid="ekiolbi5hb54"></a>
### Phase 5 - Documentation

- Link the design changes and this plan in the VitePress sidebar (done while planning).
- **[Data Architecture](/specifications/data-architecture):** the summaries section's cache (key, last use, clean-up), summary targets, pre-filling and the lookup.
- **[Server Requirements](/specifications/server-requirements):** the lookup route, `accept` and `current`, the status's `prefill`.
- **[Client Requirements](/specifications/client-requirements):** the model name and the older-model mark.
- **[Security](/specifications/security):** §4.8.
- **[Technical Architecture](/specifications/technical-architecture):** pre-filling and queue priorities in the request flow.
- `CLAUDE.md`: pre-filling and the lookup in the `summaries/` description; `.specquer/shared/agent.config.yaml` gets a commented `prefill` line.
- A Step 005 implementation status section at the end of this plan.

<a id="WORK-00204" data-uid="tdheax2y74fj"></a>
## 6. Decision Points

Taken while planning; each is _Proposed_ and the work proceeds on it unless changed.

- **D1. The cache key.** _Proposed:_ the hash covers the simplified text and the sentence count; model and prompt version are columns, so other models' and prompt versions' entries for the same text can be found (Phase 4) without a second index.
- **D2. Clean-up by last use, with no table from section IDs to entries.** _Proposed:_ the feedback in the design changes suggested a table from section IDs to cache entries. It isn't needed: the lookup works out a section's entry from the file, and pre-filling marks every entry still in use. An entry unused for 60 days is deleted. That keeps summaries over a branch switch and back, and lets the summaries of text no section has any more (old versions, deleted sections) lapse.
- **D3. Model identity.** _Proposed:_ provider, name and base URL in the cache; only the name in the UI.
- **D4. Old caches.** _Proposed:_ replaced, not migrated. Step 004's keys hash the model in, so its entries can't be found by text alone.
- **D5. The lookup never calls a model.** _Proposed:_ link previews and reports must be quick and must not send text the user didn't ask about; pre-filling is how entries get there.
- **D6. Priorities.** _Proposed:_ two levels, with background calls limited to `concurrency - 1` slots.
- **D7. Fallback order.** _Proposed:_ the configured model, then other models with the same prompt version, newest first, then older prompt versions. With two tiers (later), the better tier would go before "newest".
- **D8. The length of link previews** (concern 1 in the design changes) is left to the step that builds them; the lookup returns the stored summary whole.

<a id="WORK-00205" data-uid="jop89gucje2u"></a>
## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Pre-filling uses up the free tier's rate limit | Slider requests get 429s | Background calls never take the last slot; pre-filling backs off on 429 |
| A pass over a large repository takes hours | The cache stays incomplete for a long time | Deeper sections first, unchanged files skipped; measured in Phase 3 |
| Server and client build different targets | Pre-filled summaries are never hit | `summaryTargets` shared, with a test against the preview's requests |
| Pre-filling sends specs the user didn't expect to share | Text leaves the machine unasked | Off by default; the Security spec says what it sends |
| Replacing an older-model summary moves the text | The reader loses their place | The box keeps its height; the change is marked, not animated |
| Unused for 60 days is too long or too short | A large database, or summaries made again | Measured during use; the number is one constant |

<a id="WORK-00206" data-uid="q02uw8l23cs1"></a>
## 8. Implementation Status

Not started.
