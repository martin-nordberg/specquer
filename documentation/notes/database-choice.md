# Database Choice for the Markdown Database

_Notes from October 2026._

**Summary:** use **SQLite through Bun's built-in `bun:sqlite`**, as one database file at `.specquer/cache.db`. It is the only one of the top choices that needs no extra dependency and still works inside the single executable, and it covers everything the [Ideas](/specifications/functionality/ideas) specification describes so far. The open questions (especially question 7, on whether `.specquer` is committed) may later add a second store for the parts that must be shared through Git.

## What the Database Has to Do

From the Ideas specification:

- **Local cache:** an embedded store in `.specquer`, used by one Specquer process per repository, rebuildable from the files and Git history.
- **Section tree:** sections nested by heading level.
- **Fragments with identity:** each fragment has a history across Git commits, with internal diffs (changes inside a fragment) and external diffs (where it moved).
- **Similarity matching:** the "TBD algorithms" that detect moved or lightly edited fragments.
- **Summary cache:** keyed by section and content, invalidated when the content changes.
- **Links:** traceability between sections, and between work items and the system specification.
- **Probably later:** search across specs (open question 16) and embeddings for similarity.

## The Four Candidates

| | **SQLite (`bun:sqlite`)** | **PGlite** (Postgres compiled to WebAssembly) | **DuckDB** | **Plain files** (JSON/YAML in `.specquer`) |
|---|---|---|---|---|
| Extra dependencies | **None**, built into Bun | ~26 MB package (+ pgvector package) | Native add-on for each platform | None |
| Works in `bun build --compile` | **Yes** | **No** as tested: it loads its WebAssembly files from disk, so they'd have to be shipped beside the binary or embedded by hand | **No** as tested: it loads a platform-specific native library at runtime | Yes |
| Startup and footprint | Instant; small file | ~1.7 s cold start; 39 MB data folder when nearly empty | Fast (17 ms); small file | Instant, but slow once there are many files |
| Section tree | Recursive queries (CTEs) | Recursive queries plus `ltree` | Recursive queries | Hand-written code |
| Search across specs | **FTS5** full-text search, built in | Postgres full-text search | Full-text search extension | Hand-written code |
| Vector similarity | Through the `sqlite-vec` extension, which is a separate file and blocked by Apple's SQLite on macOS. Brute-force search in TypeScript is fine at spec scale | **pgvector**, the strongest option | Built-in array functions; a vector-search extension exists | Hand-written code |
| Workload fit | Small transactional writes and reads by key: **matches** | Same, with richer SQL | Built for analysis of whole columns; frequent small updates are its weak spot | Fine for small amounts of data that should be easy to diff |
| Shareable through Git | Binary file: merges badly | Data folder: not committable | Binary file | **Yes**: readable diffs and merges |

**What was tested,** with the project's Bun 1.4.2 on Linux:

- `bun:sqlite` runs SQLite 3.53.0 with FTS5 full-text search, JSON functions and recursive queries.
- PGlite with pgvector ran a vector query, but its compiled binary failed at startup.
- DuckDB worked under `bun run`, but its compiled binary failed to load its native library.

PGlite and DuckDB could probably be made to work by shipping files beside the binary, but that breaks the "one deliverable" principle.

## Why SQLite

- **It fits the architecture.** No new dependency, it is in the single executable, and it is already the prescribed choice in `CLAUDE.md` ("`bun:sqlite` for SQLite").
- **It fits the data.** A tree of sections, fragments with versions, links and a summary cache are ordinary relational tables. Recursive queries handle the tree, and WAL mode (write-ahead logging) handles the UI reading while background work, such as summaries or history analysis, writes.
- **Search is free.** FTS5 gives search across specs with no extra work.
- **Similarity doesn't need a vector database yet.** Fragment matching can start with text techniques in TypeScript (word shingles with MinHash or Jaccard, then a diff on the candidate pairs). If embeddings are added later, store them as BLOBs and compare them by brute force in TypeScript: a few thousand sections take milliseconds. That avoids the `sqlite-vec` problems with extension files and with macOS.
- **Its limits are acceptable.** The file is binary, so it can't be meaningfully committed or merged. That is fine while it is a cache.

## When the Other Options Would Win

- **PGlite:** if embeddings or heavy relational queries become central *and* shipping its files beside the executable, or embedding them by hand, is acceptable.
- **DuckDB:** for analysis over many commits, such as churn per section or how requirements evolve, run as a separate reporting step. It is not a good main store.
- **Plain files:** for whatever must be **shared through Git**. If question 7 decides that fragment identity, traceability links or summaries must travel with the repository, keep those in small text files (one per document or work item) that diff and merge cleanly. SQLite stays the rebuildable index over them. This hybrid is likely where the design ends up.

## Possible Table Layout

- `revisions(commit, parent, time)`
- `files(id, path)`
- `fragments(id)` holds the stable identity.
- `fragment_versions(fragment_id, revision, content_hash, kind, file_id, position)`
- `sections(id, fragment_id, parent_id, level, heading)`
- `links(from_section, to_section, kind)`
- `summaries(section_id, content_hash, model, text, created)`

Keying `summaries` on `content_hash` makes cache invalidation automatic: when the content changes, the old row simply stops matching.

To query it, start with plain SQL through `bun:sqlite`. Drizzle ORM supports `bun:sqlite` if typed schemas and migrations are wanted later; that is optional.
