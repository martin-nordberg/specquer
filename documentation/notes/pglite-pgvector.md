<a id="NOTE-00150" data-uid="kk7j1q2w75zx"></a>

<a id="NOTE-00151" data-uid="t548vd915jjx"></a>
# PGlite and pgvector for Chat and Summaries

_Notes from October 2026: whether to replace SQLite with PGlite (Postgres compiled to WebAssembly) and its pgvector extension, for the chat's search index and perhaps the summary cache. It follows [Database Choice](/notes/database-choice), which picked SQLite before either feature existed._

**Summary:** don't replace SQLite. What pgvector would add to the chat is semantic retrieval, and its real cost is the **embeddings**, not the database: every section has to be turned into a vector by a model, which either sends all the specs to a provider or ships a local model. That choice is worth making on its own merits, and SQLite can hold the vectors: at spec scale, a search over vectors kept in memory takes milliseconds. PGlite would add about 19 MB to the executable, a 1.8-second first start, a 39 MB data folder per repository and workarounds to run inside the single executable. The summary cache is a lookup by key, and gains nothing from either.

<a id="NOTE-00152" data-uid="q6l9rthskhz1"></a>
## What the Two Stores Do Today

- **The chat's search index** (`server/src/chat/search-index.ts`, `.specquer/cache/search.db`): every Markdown file the tree shows, split into heading units, in an SQLite FTS5 table with the Porter stemmer. A question becomes a quoted `OR` of its words without stop words, ranked by bm25 with titles weighted 10, the headings above 3 and the text 1. A file is indexed again when its modification time or size changes. Building it sends nothing anywhere.
- **The summary cache** (`server/src/summaries/cache.ts`, `.specquer/cache/summaries.db`): summaries keyed by the section's simplified text, the model and the prompt version, kept until unused for 60 days. Every access is a lookup by that key, or a purge by date.
- **Elsewhere:** the instance lock (`server/src/instance.ts`) is an SQLite transaction too, so SQLite stays in Specquer whatever happens to these two.

In this repository, the index holds about 850 heading units (146,000 words), and both databases are a few megabytes.

<a id="NOTE-00153" data-uid="p9a575sj7zdt"></a>
## What pgvector Would Add

Keyword search misses a section that answers the question in other words: "how is the session protected" doesn't find a section about "the token" and "the cookie" unless the words match after stemming. Embeddings place text with similar meaning near each other, so a vector search finds such sections. The usual design is **hybrid**: run the keyword and the vector search, and merge their rankings (reciprocal rank fusion), since keyword search is still better at exact terms such as section IDs, names and error messages.

That needs three things, of which a vector store is the smallest:

1. **An embedding model**, to turn each unit into a vector when it is indexed, and each question when it is asked.
2. **A place to keep the vectors,** with the unit and the model that made them, re-made when the text or the model changes.
3. **A nearest-neighbor search,** merged with the keyword ranking.

pgvector provides the second and third. The first is the hard part.

<a id="NOTE-00154" data-uid="l1w50q9lkbys"></a>
## The Embeddings Are the Real Cost

- **A provider.** NVIDIA's API catalog, which Specquer already uses, offers embedding models through the same OpenAI-compatible API (the model IDs have to be checked against the catalog when chosen; LangChain.js has `OpenAIEmbeddings`). But indexing sends **every unit of every spec** to the provider, up front and after each change, and every question too. Today the chat sends only the retrieved sections, and only when a question is asked. That is the same change in privacy as pre-filling summaries, and needs the same handling: off by default, a warning, and the user's approval when the shared configuration switches it on ([Security](/specifications/security) §9).
- **Rate limits.** The free tier allows about 40 requests a minute. Embedding endpoints take batches, so a few thousand units are a few dozen requests, but a first index of a large repository still takes minutes, and a branch switch can re-embed many files.
- **A local model** instead (ONNX through `transformers.js` or similar) keeps everything on the machine, but adds tens to hundreds of megabytes of model to the executable or a first-run download, CPU time for every changed file, and a native or WebAssembly runtime that `bun build --compile` must carry, the same packaging problem as PGlite's.
- **Re-embedding.** Changing the embedding model invalidates every vector. That is cheap to detect (store the model with each vector), but not cheap to redo.

<a id="NOTE-00155" data-uid="hfwr49gfb77u"></a>
## PGlite, Measured

Tried in October 2026 with `@electric-sql/pglite` 0.5.10 and `@electric-sql/pglite-pgvector` 0.0.11, under the project's Bun 1.4.2 on Linux:

| | SQLite (`bun:sqlite`) | PGlite with pgvector |
|---|---|---|
| Dependencies | None, built into Bun | 35 MB package, plus the pgvector package |
| First open | About 1 ms | **1.8 to 2.0 s**: it runs `initdb` to create the database |
| Later opens | About 1 ms | **About 370 ms** |
| Empty database on disk | A few kilobytes | **39 MB** data folder, per repository |
| Release executable | 85.6 MB today | About **105 MB** (the WebAssembly and data files add about 19 MB) |
| In `bun build --compile` | Works | Works **only with workarounds**, below |
| Vector search | Not built in | `vector` type, `<=>` cosine distance, HNSW and IVFFlat indexes |
| Full-text search | FTS5 with bm25 | `tsvector` with `ts_rank`, which isn't bm25 |
| Connections | Several, WAL mode | One: Postgres in single-user mode, queries one at a time |

**The single executable.** [Database Choice](/notes/database-choice) found that PGlite's compiled binary failed. With 0.5.10 a plain `--compile` build still fails: PGlite loads `pglite.wasm`, `initdb.wasm` and `pglite.data` from beside its module, and the extension from `vector.tar.gz` beside the pgvector package, none of which Bun embeds. It works when the program:

1. imports the three files and the extension bundle with `with { type: "file" }`, so Bun embeds them;
2. compiles the two WebAssembly files itself and passes them as `pgliteWasmModule` and `initdbWasmModule`, with the data file as `fsBundle`;
3. copies the extension bundle out to a temporary file at startup and gives the extension that path, because PGlite reads extension bundles through Node's file streams, which can't see Bun's embedded files.

That is workable, but it depends on PGlite's internals (file names, how it reads bundles) in a library still at 0.x, with an extension package at 0.0.11.

**What else PGlite would bring:**

- **Postgres's SQL:** `JSONB`, richer types, `ltree`, the same dialect as a hosted Postgres if Specquer ever runs as a shared service.
- **One store for both kinds of search,** with an index for vectors (HNSW) that matters only at sizes far beyond specs.
- **Running in the browser** too, which Specquer doesn't need: the browser never touches the databases.

**What it would cost besides the numbers:**

- **Two engines.** SQLite stays for the instance lock, and for the summary cache unless that moves too.
- **Weaker keyword ranking.** Postgres's `ts_rank` counts matches but doesn't weigh rare terms the way bm25 does, and `websearch_to_tsquery` joins words with `AND`, so the query would have to be built as today's `OR`. In the test, "token storage" didn't match "the session token is stored…": `AND` needs both words, and "storage" and "stored" stem differently.
- **The event loop.** PGlite runs Postgres in WebAssembly on the JavaScript thread, so a slow query or a large re-index blocks the server's other requests unless PGlite is moved into a Worker.
- **Tests.** Each fresh database runs `initdb` (about 1.8 s), which the server tests would have to avoid with a shared snapshot (`loadDataDir`) or one database per test file.
- **`CLAUDE.md`'s rule** to use `bun:sqlite` for SQLite would change, along with the code that moves damaged databases aside and rebuilds them.

<a id="NOTE-00156" data-uid="bw4et7guav7a"></a>
## The Summary Cache

The cache stores and finds summaries by key: the section's text, the model and the prompt version. It has no use for similarity, and should not get one: a summary found for *similar* text would summarize text that isn't on the page. Moving it to PGlite would add every cost above for no gain. It stays in SQLite in every option below.

<a id="NOTE-00157" data-uid="jwgtrxdxhbxe"></a>
## Options

| Option | Retrieval | New dependencies | Executable | Privacy | Effort |
|---|---|---|---|---|---|
| **A. Keep FTS5 as it is** | Keywords only | None | Unchanged | Unchanged | None |
| **B. Better keyword search** | Keywords, with prefix matching, synonyms from the model, or both | None | Unchanged | Unchanged, or one model call per question | Small |
| **C. Embeddings in SQLite** | Hybrid: FTS5 and vectors searched in memory, merged | An embeddings call (LangChain.js) | Unchanged | All specs sent to the provider, opt-in | Medium |
| **D. `sqlite-vec`** | Hybrid, with SQL vector search | A native extension per platform | Extension files to ship | As C | Medium, and blocked on macOS |
| **E. PGlite with pgvector** | Hybrid, with SQL vector search | PGlite and pgvector packages | About +19 MB, with workarounds | As C | Large |

- **B** costs least: it keeps keyword search, but searches with more of the right words. How it would work is described [below](#how-option-b-would-work). It may close much of the gap without embeddings.
- **C** keeps one engine and the single executable. Each unit's vector is a `BLOB` in a new table of `search.db`, keyed by unit and model and dropped with its file's units. At search time the vectors are compared in TypeScript: for this repository's 850 units, a fraction of a millisecond; for 10,000 units of 1,024 dimensions, about 40 MB of memory and a few milliseconds per question. Smaller or quantized vectors cut that further.
- **D** was ruled out in [Database Choice](/notes/database-choice): the extension is a separate native file for each platform, Apple's system SQLite can't load extensions, and the single executable would have to carry and unpack it.
- **E** gives the most capable store, at the costs measured above, for a scale specs don't reach.

<a id="NOTE-00158" data-uid="mr7ooj7k3an3"></a>
## How Option B Would Work

B leaves the index as it is and changes how a question is turned into a search. Today a question goes through one step: its words, without stop words, are quoted and joined with `OR`, and FTS5 ranks the units by bm25. B adds up to four steps before that search, and one after it. Each can be built and scored on its own.

Take the question **"How is the session protected against other websites?"** Today it becomes `"session" OR "protected" OR "against" OR "websites"`. The sections that answer it ([Security](/specifications/security) §3 and §4) talk about "the token", "the cookie", "SameSite" and "Origin". Of the question's words they contain only "session", which many other units contain too (chat history, summaries, the instance lock), so the right units may not be among those sent.

<a id="NOTE-00159" data-uid="onfy6cmjnenc"></a>
### Step 1: Section IDs Go Straight to Their Section

A question that names a section ID ("What does REQ-00012 require?") looks the section up directly in the section index, as the lookup by ID already does, and sends that unit first, whatever bm25 says. Today the ID is split into "req" and "00012", and "00012" matches only units that happen to link to it.

**Cost:** none. No model call, no index change.

<a id="NOTE-00160" data-uid="br3sbl9irw82"></a>
### Step 2: Prefixes for Longer Words

Each term of five letters or more is searched as a prefix too: `"protect"*` matches "protection", "protecting" and "protects", and `"auth"*` would match "authentication" and "authorize". The Porter stemmer already joins "stored" and "store", but not "storage", and not words where English stems differ. Short terms stay whole, so "id" doesn't match every word starting with "id".

**Cost:** none to speak of. FTS5 answers prefix queries without a special index at spec scale; a `prefix='3 4'` option on the table makes them faster if needed.

<a id="NOTE-00161" data-uid="bujvk87lgynz"></a>
### Step 3: The Model Adds the Specs' Words

Before searching, Specquer asks the chat's model for the words a spec answering the question would probably use: synonyms, technical terms and related concepts, as a short list of words and phrases, nothing else. For the example question, it might answer:

```
session token, cookie, CSRF, cross-site request, Origin header, Host header, authentication, SameSite
```

The search then runs twice:

1. the question's own words, as today;
2. the model's words, quoted and joined with `OR` in the same way, so nothing the model writes can change FTS5's syntax.

The two rankings are merged by reciprocal rank fusion: each unit scores `1 / (60 + rank)` in each list it appears in, and the sums are sorted. A unit both lists find rises to the top. The question's own words keep a small advantage (their list counts once and a half), so an expansion that wanders off can't push out what the question asked for directly.

**Follow-ups** work as today: the previous question's words join the question's, and the model is shown both questions.

**Cost:**

- **Time:** one short model call, a second or two, before "Searching the specs…". It goes through the call queue with interactive priority, and Stop cancels it like the answer.
- **Rate limit:** two calls per question instead of one, against the provider's limit.
- **Privacy:** nothing new. The call carries the question (and the previous one), which the answer's call sends anyway, and no text from the specs.
- **Failure:** if the call fails or times out, the search runs with the question's own words alone, as today.

**A variant** gives the model more to go on: the titles of the specs' headings, so it can name terms the specs actually use. That sends every heading in the repository with each question, which is a change of privacy; it would need the same opt-in as pre-filling.

<a id="NOTE-00162" data-uid="fnkh2fqez3w7"></a>
### Step 4: A Trigram Index for Names and Fragments

A second FTS5 table over the same units, with the `trigram` tokenizer (present in the SQLite of Bun 1.4.2), matches any three or more consecutive characters. It finds parts of identifiers and file names that word tokens split badly: "uistate" in `uistate.yaml`, "SectionIndex", `prefix.config`. It is searched only for terms that look like names (dots, camelCase, underscores) and merged with the same fusion.

**Cost:** the index grows by about two to three times its size, and building it takes longer. Worth it only if the evaluation shows questions about names failing.

<a id="NOTE-00163" data-uid="otrpqb7xbpms"></a>
### After the Search: Fill the Budget Better

The units found are cut to the context budget as today, with one change: a unit that several searches found, or a section ID found in step 1, is never cut away in favor of one only a single search found.

<a id="NOTE-00164" data-uid="b3o40893z00m"></a>
### What B Can't Do

B still finds text by its words. A section that describes the answer with no word the question or the model thought of is still missed. The model's guesses help most where specs use standard vocabulary, and least where a team has its own terms. If the evaluation shows misses of that kind after steps 1 to 3, embeddings (option C) are the next step.

<a id="NOTE-00165" data-uid="x6tgb5i6x93u"></a>
### Where It Would Go

- `server/src/chat/query.ts`: section IDs in a question, prefix terms, quoting the model's words.
- `server/src/chat/search-index.ts`: several searches merged by reciprocal rank fusion; the trigram table (schema version 2, so the index is rebuilt once).
- `agent/src/chat.ts`: the expansion prompt and its parsing (words and phrases only, at most 15, the rest ignored), tested with `FakeListChatModel`.
- `server/src/chat/service.ts`: the expansion call before the search, with its fallback.
- `chat.expandQuery` in the agent configuration, on by default where a model is configured, so it can be switched off.

<a id="NOTE-00166" data-uid="ztb634iqmsjg"></a>
## Recommendation

1. **Measure first.** Write 20 to 30 questions about this repository's specs, with the sections that answer them, and score today's retrieval (how often the right section is among those sent). Without that, no option can be shown to help.
2. **Try B,** in the order of [its steps](#how-option-b-would-work), scoring each step with the same questions.
3. **If B falls short, do C,** as an opt-in setting with the same approval as pre-filling, in the existing `search.db`, with hybrid ranking. It can also use a local embedding model later without changing the store.
4. **Keep the summary cache in SQLite.**
5. **Revisit PGlite** only if one of these becomes true:
   - **Scale:** a repository's units outgrow a search in memory (hundreds of thousands);
   - **Hosting:** Specquer becomes a hosted, shared service, where the same SQL as a server's Postgres matters;
   - **Relational work:** the work grows beyond what SQLite does well, such as section history across commits or traceability analysis;
   - **Packaging:** PGlite's packaging for single executables becomes supported rather than a workaround.

<a id="NOTE-00167" data-uid="z2r1gh98h9gd"></a>
## Questions

1. **Is semantic retrieval wanted badly enough** to send every spec to the provider, or to ship a local model? The answer decides between B and C before any database question.
2. **Should embeddings follow pre-filling's rules** (off by default, approval for the shared setting), or have their own?
3. **Is a hosted, shared Specquer on the horizon?** It is the strongest reason for Postgres, and would favor a real Postgres server over PGlite anyway.

<a id="NOTE-00168" data-uid="nkilkrrstlbq"></a>
## References

- [Database Choice](/notes/database-choice), the earlier comparison of SQLite, PGlite, DuckDB and plain files
- [Step 010, Document Chat](/work-items/step-010-document-chat/requirements), and [Data Architecture](/specifications/data-architecture) §5, the chat's index
- [Security](/specifications/security) §9, what is sent to the model provider
- [PGlite](https://github.com/electric-sql/pglite), and [the v0.4 announcement](https://electric.ax/blog/2026/03/25/announcing-pglite-v04) (March 2026: `initdb` as a separate WebAssembly process, connection multiplexing)
