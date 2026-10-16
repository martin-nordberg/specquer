<a id="SPEC-00073" data-uid="dtnurz41yejv"></a>

<a id="SPEC-00074" data-uid="unvuw5mk0cjh"></a>
# Specquer Server Requirements

Requirements for the back end (`server/`). They come from [Step 001](/work-items/step-001-doc-editing/requirements) and its [implementation plan](/work-items/step-001-doc-editing/implementation-plan), [Step 002](/work-items/step-002-sections/requirements) (sections), [Step 003](/work-items/step-003-section-uids/implementation-plan) (section UIDs and conflicts), [Step 004](/work-items/step-004-hierarchical-summarization/requirements) (summaries), [Step 005](/work-items/step-005-summarization-changes/implementation-plan) (the lookup, pre-filling and the cache), [Step 006](/work-items/step-006-settings/requirements) (settings), [Step 007](/work-items/step-007-no-documents-file/requirements) (no `documents.yaml`) [Step 008](/work-items/step-008-refactor-settings/requirements) (folder types and prefixes) and [Step 009](/work-items/step-009-single-instance/requirements) (one Specquer per root folder) and [Step 010](/work-items/step-010-document-chat/requirements) (document chat) and [Step 014](/work-items/step-014-all-files/requirements) (All Files, and files other than Markdown). Security is specified separately in [Security](security.md).

<a id="SPEC-00075" data-uid="sb2taf3fhmvs"></a>
## 1. Command Line

```
specquer [root] [--port <n>] [--no-open]
```

1. **`root`** (optional): the folder to work in, absolute or relative to the working directory; it defaults to the working directory. Specquer resolves it to its real path at startup and exits with an error (exit code 2) if it doesn't exist or isn't a folder. Exit code 3 means another Specquer already serves the root folder, and exit code 4 that the folder is inside a nested Specquer folder (§2).
2. **`--port <n>`**: listen on this port, and fail if it is taken. Without it, Specquer tries port 4870 and falls back to a free port, so it can run in several folders at once.
3. **`--no-open`**: don't open a browser. For a future desktop shell or a coding agent, which read the URL from the output instead.
4. Arguments are parsed with `parseArgs` from `node:util`. Unknown options or more than one root are errors.

<a id="SPEC-00076" data-uid="h9hdfvo6dcom"></a>
## 2. Launch

1. **Finding the root** ([Step 009, nested Specquer folders](/work-items/step-009-single-instance/nested-specquer)). Specquer looks for a `.specquer` folder in the given folder and in each folder above it, up to the top of the Git work tree it is in (outside Git, up to the root of the file system). With none, or only one in the given folder, the given folder is the root. With one in a folder above, that folder becomes the root, with a warning naming both. With two or more, Specquer prints them, says it can't run in a nested Specquer folder, and exits with code 4 before locking or writing anything.
2. **One Specquer per root folder** ([Step 009](/work-items/step-009-single-instance/requirements)), the root found in item 1. Before it serves anything or reads the section data, Specquer takes an exclusive lock on `.specquer/user/instance.lock`: an open `BEGIN EXCLUSIVE` transaction on an SQLite database, held for the life of the process and released by the operating system however the process ends. If another process holds it, the launch starts no server and writes nothing: it prints `Specquer is already serving <root>` and `Open <url>` with the running instance's URL, opens that URL unless `--no-open` is given, and exits with code 3. `--port` is then ignored, with a warning. If the running instance hasn't written its URL yet, the launch says Specquer is already running and opens nothing. If the lock can't be created for another reason (a read-only folder), Specquer warns and starts without it.
3. **The instance file.** Holding the lock, Specquer deletes any `.specquer/user/instance.json` left by a crash, and once listening writes `{ pid, port, url, root, startedAt }` there, atomically and readable by its owner only. A clean exit (including SIGINT and SIGTERM) deletes it.
4. The server listens on `127.0.0.1` only.
5. Once listening, it prints the root folder and the launch URL, `http://127.0.0.1:<port>/?token=<token>`.
6. Unless `--no-open` is given, it opens the launch URL in the default browser: `open` on macOS, `xdg-open` on Linux, `cmd /c start "" <url>` on Windows. Failure to open a browser is reported but not fatal.
7. Under `bun --hot` (development) the token and the instance lock are kept, the instance file is written once, and the browser is opened at most once per process.
8. The development command (`bun run dev`) serves the repository itself on port 3000.

<a id="SPEC-00077" data-uid="i1pnvwdznkri"></a>
## 3. File Tree

`GET /api/tree` returns both views of the tree, `{ specs, all }`, each `{ root, truncated }`, built from one listing of the files ([Step 014](/work-items/step-014-all-files/requirements)).

1. **Specs** lists only `.md` files (case-insensitive extension), with the folders that contain them, directly or further down. Empty folders (holding no files, only other empty folders if any, or only a `.specquer-config.yaml`) are listed too, so a folder created through the API shows. Other folders without Markdown files are left out. **All Files** lists every file, with its folders, and empty folders.
2. `.git` and `node_modules` (at any depth) are never listed. Of `.specquer`, **All Files** lists the root's `shared/` folder only; `.specquer/user/`, `.specquer/cache/` and nested `.specquer` folders are never listed, whatever `.gitignore` says. **Specs** lists nothing in `.specquer`.
3. In a Git work tree, the list comes from `git ls-files --cached --stage` and `git ls-files --others --exclude-standard`, so `.gitignore` rules (including nested ones and global excludes) apply. Tracked files deleted from disk (`git ls-files --deleted`) and submodules are left out, as are tracked symbolic links that don't lead to a file; no other file is `stat`ed. Git doesn't list empty folders, so the server also asks it for untracked folders that aren't ignored (`git ls-files --others --exclude-standard --directory`) and walks those to find the empty ones.
4. Outside a Git work tree, the server walks the folders itself; no ignore rules apply then.
5. The tree is loaded in one request. Each view holds at most 10,000 files, and walks of the file system stop after 100,000 entries; beyond either limit a view is cut off and marked as truncated, each on its own.
6. Folders come before files; names sort naturally, ignoring case.
7. Each tree load also starts a background scan of the sectioned files (§7), which writes nothing.
8. **One listing.** A tree load always lists the files again. The listing is then shared, for up to 2 seconds, by the background scan, the chat's index, pre-filling, **Section problems**, comment problems and the checks of `GET /api/view` and `GET /api/image`; callers at the same moment share one listing. Specquer's own creates, renames, deletes and configuration writes make the next caller list again. Every operation that writes the section data files (a save, a create, a rename, a delete, renumbering, **Add section anchors**) lists again, so it never misses a file added or an ID written outside Specquer. Per-file checks of modification times run 16 at a time.

<a id="SPEC-00078" data-uid="lp2g1616i6v2"></a>
## 4. Files

| Route | Behavior |
| ----- | -------- |
| `GET /api/file?path=` | Returns the file's text and its **version** (SHA-256 of its bytes). |
| `PUT /api/file?path=` | Body `{ text, baseVersion }`. Writes the text if the file's current version equals `baseVersion`; otherwise answers `409` with the current version and writes nothing. Returns the new version. For a sectioned file, the anchors are added and corrected first (§7) and the response also carries `edits`, relative to the body sent, and `notices` for what changed beyond adding anchors (a copy renumbered, an edited ID put back, a reused number, a copied UID). A sectioned file with merge conflict markers is written as sent, with a notice. |
| `POST /api/create` | Body `{ parent, name, kind, prefix?, folderType? }` (`kind` is `file` or `folder`; `parent` is `""` for the root). Creates an `.md` file or an empty folder in `parent`, which must be an existing folder. A new file is empty, or holds its root anchor if it is sectioned, with an ID in `prefix` or else the folder's default prefix. A new folder with a `folderType` or `prefix` gets a `.specquer-config.yaml` holding them. `409` if the name is taken. Answers `201` with the new path. |
| `POST /api/rename` | Body `{ path, newName }`. Renames a file or folder within its folder. `409` if the name is taken. Returns the new path and the updated UI state. |
| `GET /api/entry/delete-preview?path=` | Lists the files a delete would remove (up to 500, with the total count) and those not committed to Git, or `null` outside Git. |
| `DELETE /api/entry?path=` | Deletes a Markdown file or a folder with everything in it. Another file answers `400`. Returns the updated UI state. |
| `GET /api/view?path=` | A file other than Markdown, to show it: `{ kind: "text", path, text, size, version }` (UTF-8 without NUL bytes, at most 5 MB, without its byte-order mark), `{ kind: "image", path, size, version }`, or `{ kind: "other", path, size, reason }` with `reason` `binary`, `not_utf8` or `too_large` (over 5 MB, found before reading). Only files the **All Files** listing holds: any other path, such as one `.gitignore` hides, answers `404`. Paths may be in `.specquer/shared/`. A Markdown path answers `400`. |
| `GET /api/image?path=` | The bytes of a listed image (PNG, JPEG, GIF, WebP, AVIF, SVG, BMP, ICO) of at most 5 MB, with `Content-Type` from its extension. Another file answers `415`, a larger one `413`, an unlisted one `404`. Headers in [Security](security.md) §7; a weak `ETag` from the modification time and size, and `304` to a matching `If-None-Match`. |

1. All paths are workspace paths, validated and confined to the root as specified in [Security](security.md) §5. Invalid paths answer `400`, missing entries `404`, paths leading outside the root `403`.
2. Only existing `.md` files can be read through `GET /api/file` or written; other files are only shown, through `GET /api/view` and `GET /api/image`. `PUT /api/file` doesn't create files. New files are created through `POST /api/create`, whose name must end in `.md`, and never replace an existing file or folder. Files must be UTF-8; others answer `415`. A byte-order mark is kept.
3. The server deals in whole file text, byte for byte: splitting into front matter and body happens in the client, so line endings and the trailing newline are preserved. The one exception is a sectioned file, whose anchors the server adds and corrects (§7), keeping its line endings, front matter and byte-order mark.
4. Writes are atomic: the text is written to a temporary file in the same folder, given the original's permissions, and renamed over the original.
5. Only Markdown files and folders can be renamed, a file only to a name with the same extension. A case-only rename works on case-insensitive file systems.
6. "Not committed" means new, modified, deleted or ignored according to `git status --porcelain --untracked-files=all --ignored=matching`.
7. Errors are JSON: `{ error, message }`.

<a id="SPEC-00079" data-uid="zoiamab59gay"></a>
## 5. UI State

| Route | Behavior |
| ----- | -------- |
| `GET /api/uistate` | Returns the stored UI state. |
| `PATCH /api/uistate` | Merges the given top-level fields into the stored state (`null` clears `theme` or `currentFile`) and returns the result. |

1. The state is stored in `.specquer/user/uistate.yaml` under the root, read and written with `Bun.YAML`, atomically.
2. Whenever the server writes to `.specquer/user/` (or opens a cache in `.specquer/cache/`) and the folder has no `.gitignore`, it writes one containing `*`, whether it created the folder or not. It never overwrites an existing `.gitignore` there and never changes the repository's own `.gitignore` files.
3. Invalid or unknown content falls back to defaults, field by field; it never stops the server.
4. Entries for files and folders that no longer exist are dropped whenever the state is read or updated.
5. Renames and deletes through the API update the stored state in the same request.
6. Updates are applied one at a time. Across tabs and windows, the last write wins.

The model is specified in [Data Architecture](data-architecture.md) §3.

<a id="SPEC-00080" data-uid="eift7pjses41"></a>
## 6. Sections

| Route | Behavior |
| ----- | -------- |
| `GET /api/sections?path=` | The sections of one document, for badges: ID, UID (from the anchor; `null` for a section renumbered on the next save), kind, title, heading level, and the problem when its ID is also used elsewhere (the other occurrences, and whether this one keeps the ID). |
| `GET /api/sections/search?q=&limit=&path=` | Sections whose ID or title starts with (or else contains) `q`, across documents or in the document at `path`, for link completion; at most `limit` (default 50, at most 200). |
| `POST /api/sections/anchor` | Body `{ folder, dryRun, addAgentGuide }`. **Add section anchors**: returns the sectioned files under the folder whose anchors would change, and unless `dryRun` changes them. With `addAgentGuide` (and not `dryRun`) it also appends the section anchor rules for coding agents to the root folder's `AGENTS.md`, creating it if needed. The response says whether `AGENTS.md` holds the rules (`agentGuide`). |
| `GET /api/sections/problems?folder=` | The problems in a folder's sectioned files: nested Specquer folders (`{ kind: "nested-specquer", folder }`, a folder below the root with a `.specquer` folder of its own, whose section data is ignored), copied documents (`{ kind: "copied-document", paths }`, files holding one document ID with no known original), duplicate and colliding IDs waiting for the user, stray anchors, files with merge conflict markers, statuses that aren't allowed (`{ kind: "invalid-status", path, id, line, value, prefix }`), and unusable prefix settings (`{ kind: "prefix-config", prefix, path, problem, message }`, for the prefixes the folder's sections use). |
| `GET /api/sections/statuses?path=` | The status lists for a file's sections: `{ sectioned, folderPrefix, statusValues }`, the allowed statuses of each prefix with a usable `.specquer/shared/<prefix>/prefix.config.yaml` (the others use the defaults). |
| `POST /api/sections/renumber` | Body `{ path, id, uid, baseVersion }`. Gives one occurrence of a duplicate or colliding ID a new number, rewriting the file as a save would. `409` if the file is no longer at `baseVersion`. Returns the new version, the `edits` (relative to the body on disk) and `notices`. |
| `POST /api/sections/renumber-document` | Body `{ path, baseVersion }`. Renumbers every section of a file of a copied document, its root section included, as a copy is renumbered; the other file keeps the document ID. `409` and the response as for `renumber`. |

<a id="SPEC-00081" data-uid="y8x093ygagyo"></a>
## 7. Section Anchors and Data Files

1. Which files are sectioned, and the default prefix for a file's root section, come from the folders' `.specquer-config.yaml` files (Data Architecture §2.3); without one no file is sectioned. A new section takes its parent section's prefix, or the one its `XYZ-?` placeholder asks for.
2. The server keeps an index of the sectioned files and of `.specquer/shared/<prefix>/sections.yaml`. No file records documents by path. It is brought up to date in the background at startup and after each tree load, by reading only files whose modification time or size changed. This never writes a file. Saving, creating, renumbering, listing problems and **Add section anchors** bring it up to date first, so files changed outside Specquer are never missed. The data files are read again when they change on disk (a pull, a branch switch).
3. Section IDs are allocated on the server only, one update at a time, so two tabs can never get the same number. Numbers are never reused.
4. Documents and data files are written only when the user changes something: saving, creating, renaming or deleting through the API, renumbering a duplicate, and **Add section anchors**. The data files then hold the whole reconciled state.
5. Renames and deletes drop the documents that are gone or no longer in a sectioned folder; their sections are retired, so they are recognized if they come back. A document moved or renamed outside Specquer keeps its ID through its root anchor's UID.
6. Data files are written atomically and only when their content changes; damaged or conflicted data files never stop the server.
7. Saving fixes what is certain (a copy within a document or of a whole file, an edited ID, a reused retired number, a copied UID) and does what `XYZ-?` asks (another prefix, keeping the UID), and says so in `notices`. A duplicate across documents and a collision of two sections with one ID are reported and renumbered only when the user asks.
8. A sectioned file with merge conflict markers is never anchored until they are resolved.
9. A whole file copied keeps its document ID in the original: the file where the server last saw the document alone in this session, or else the one file Git's index tracks. Otherwise both files are reported as a copied document and left unanchored (saves return the `not-anchored` notice with `reason: "copied-document"`) until the user renumbers the copy.
10. Each prefix's allowed statuses come from `.specquer/shared/<prefix>/prefix.config.yaml`, read again when it changes; an unusable file leaves the prefix on the defaults and is reported (Data Architecture §2.9). Saving (and every other rewrite of a sectioned file) corrects a status written in another case or with spaces around it, silently; it never changes an invalid status, nor a status when an ID or UID changes.

The model, recognition rules, data files and conflict rules are specified in [Data Architecture](data-architecture.md) §2.

<a id="SPEC-00082" data-uid="p3j1jhs04fnl"></a>
## 8. Summaries

| Route | Behavior |
| ----- | -------- |
| `GET /api/summaries/status` | `{ enabled, model? , problem?, prefill }`: whether summaries can be made, the configured model's ID, and otherwise why not (no model configured, or its key variable not set); `prefill` is `{ enabled, pending }`, whether pre-filling runs and how many sections its pass has queued or is summarizing. |
| `POST /api/summaries` | Body `{ path, text, headings, accept? }`: a section's saved text (at most 1 MB), its document, the titles of the headings above it, and `"current"` (the default) or `"any"`. Returns `{ summary, model, cached, truncated, current }`. With `accept: "any"`, a cached summary from another model or an older prompt is returned at once, with `current: false`. The client aborts the request when the summary is no longer needed. |
| `GET /api/summaries/sections/:id` | A section's summary by section ID, from the cache only: `{ kind: "text", text }` for a short section or a list item, `{ kind: "summary", summary, model, truncated, current }`, or `{ kind: "none" }`. `404` for an unknown ID, `400` for an invalid one. It never calls a model, and works with summaries disabled. |

1. The configuration is read from `.specquer/shared/agent.config.yaml`, overridden by `.specquer/user/agent.config.yaml`, with the `yaml` package, and read again when either file's modification time changes. Invalid values are reported on the console and ignored, each on its own; they never stop the server. API keys come from the server's environment, through the variable the configuration names.
2. The server simplifies the text, and returns a section of fewer than 60 words as written, without calling the model. Otherwise it answers from the cache, or calls the model.
3. At most `summaries.concurrency` model calls (default 2) run at once. Interactive calls start before waiting background ones, and background calls take at most one less than the limit (at least one). Requests for the same text share one call. A call whose requests were all aborted is dropped if it hasn't started; one that has started runs to the end and its summary is cached, so moving the slider back and forth doesn't throw away calls under way. An aborted request isn't logged as an error.
4. A section estimated (at four characters a token) above `summaries.tokenBudget` (default 24,000) is summarized from its lead text and its subsections' summaries, each found in or added to the cache; one without subsections is cut at the budget, and `truncated` says so.
5. Summaries are cached in `.specquer/cache/summaries.db` (`bun:sqlite`, WAL mode) by a hash of the simplified text and the summary's sentence count, the model (provider, name and base URL) and the prompt version. Summaries unused for 60 days are deleted at startup and once a day while summarizing. A cache written by an older version of Specquer is emptied. When the server creates `.specquer/cache/`, it also writes `.specquer/cache/.gitignore` containing `*`. A database that can't be read is moved aside (`summaries.db.damaged-<time>`) and created again; the cache never stops the server.
6. Errors use the usual JSON body: `503 not_configured` without a model or its key, `429 rate_limited` for the provider's rate limit, `502 provider_error` for other provider and network failures (with the provider's message).
7. Summaries the slider asks for come with their text from the authenticated client. The server reads files for summaries only for the lookup by section ID and for pre-filling ([Security](security.md) §9).
8. With `summaries.prefill: true` (approved by this user when it comes from the shared file, Security §9), a model and its key, the server summarizes every section of every Markdown file in the background: 10 seconds after startup and after changes to the files, deepest sections first, skipping files unchanged since their last complete pass, and pausing (one minute, doubling to 15) after a rate limit. It is off by default.

The rules for summaries are specified in [Data Architecture](data-architecture.md) §4.

<a id="SPEC-00112" data-uid="yzticufqp04t"></a>
## 9. Settings

| Route | Behavior |
| ----- | -------- |
| `GET /api/settings/agent` | Both agent configuration files (`shared`, `personal`), each with its `version` (`""` while it doesn't exist), the model and summaries settings it sets, the values in it ignored as invalid (`warnings`) and its YAML `error`, if any; the settings in effect (`effective`) and where each comes from (`sources`: `personal`, `shared` or `default`); whether each key variable the files name is set (`keys`); and the summary status; and the shared settings in effect that wait for this user's approval (`approval`: `{ model?: { baseUrl, apiKeyEnv }, prefill }`, Security §9). |
| `PUT /api/settings/agent` | Body `{ scope, baseVersion, model?, summaries? }`, `scope` being `"shared"` or `"personal"`. Writes the settings given to that file; `null` removes one (`model: null` the whole block). Saving to the shared file approves the model endpoint saved and `prefill: true`. Returns `{ version }`. |
| `POST /api/settings/agent/approve` | Body `{ model?: { baseUrl, apiKeyEnv }, prefill?: true }`. Records that this user approves the shared model endpoint, or the shared pre-filling, in `.specquer/user/approvals.yaml`. |
| `GET /api/settings/env?name=` | `{ set }`: whether an environment variable (a valid name) is set on the server. Never its value. |
| `POST /api/settings/model-test` | Body: a model configuration, saved or not. Makes one call with a fixed prompt holding nothing from the specs, a 30-second timeout and no retries. Returns `{ ok: true, ms }` or `{ ok: false, problem }`, the problem in the user's terms with the key's value never repeated. One test runs at a time: a new one stops the one running, which answers "Stopped: another test started." |
| `GET /api/settings/folder?path=` | A folder's `.specquer-config.yaml`: its `version` (`""` while it doesn't exist), its own settings (`own`: `folderType` and `defaultPrefix`, each a value or `inherit`), what it inherits from the folders above, key by key, with the folder that sets it (`inherited`), and the file's YAML `error`, if any. |
| `PUT /api/settings/folder` | Body `{ path, setting, baseVersion }`. Writes the folder's two keys (a key set to `inherit` is removed, and a file left with no keys deleted), then rescans the sections, so a folder's sections are retired or restored at once. Returns `{ version, sectioned }`, whether the folder is sectioned now. |

1. The routes write only `.specquer/shared/agent.config.yaml`, `.specquer/user/agent.config.yaml` (creating `.specquer/user/` with its `.gitignore`) and a folder's `.specquer-config.yaml`, at fixed paths. Folder paths are workspace paths of existing folders inside the root, whose real paths are inside the root (`404` otherwise, `400` for a file); a folder's file that is a symbolic link is never read or written (`403`).
2. Values are validated with the shared schemas (`400` otherwise). A file is never created to hold nothing.
3. Edits keep comments, key order and keys Specquer doesn't know. A save whose `baseVersion` is no longer the file's answers `409` with the current `version`; a file that isn't valid YAML (or isn't a mapping) answers `422` and is never rewritten. Saves run one at a time.
4. After a save, the configuration is read again at once, even within the same millisecond as the last write: a changed model applies to the next summary, and pre-filling restarts if needed.

<a id="SPEC-00083" data-uid="xukyl7a3b43e"></a>
## 10. Other Routes

| Route | Behavior |
| ----- | -------- |
| `GET /` | The client page (see [Security](security.md) §3 for the token exchange and §7 for its headers). |
| `GET /_specquer/preview-worker.js` | The bundled preview Web Worker ([Technical Architecture](technical-architecture.md) §7.3). |
| Bundled client assets | Served by `Bun.serve()`'s routes. |

<a id="SPEC-00125" data-uid="gzjcc0d6hr67"></a>
## 11. Chat

| Route | Behavior |
| ----- | -------- |
| `POST /api/chat` | Body `{ question, openFile? }` (1 to 8,000 characters, not blank; `openFile` a Markdown path). Answers with server-sent events, each a JSON event named by its `type`: `status` (`searching`, then `thinking`), `citations` (the numbered sources: `n`, `path`, `outlinePath`, `sectionId` if any, `title`), `token` (a piece of the answer), then `done` (`model`, `elapsedMs`, `at`) or `error` (`code`, `message`). A comment (`: keep-alive`) goes out every 5 seconds while the stream is quiet, since Bun closes a started response that sends nothing for 10 seconds. Without a model or key it answers `503 not_configured` before streaming; an invalid body `400`. Closing the request stops the answer. |
| `GET /api/chat/history` | `{ turns }`: the conversation, oldest first. |
| `DELETE /api/chat/history` | Clears it; returns the turns cleared, for Undo. |
| `PUT /api/chat/history` | Body `{ turns }`: puts cleared turns back in front of any added since; returns the conversation. |

1. **Search.** Every Markdown file the tree lists (the same rules, so files Git ignores are never searched or sent) is split into heading units and indexed in `.specquer/cache/search.db` (SQLite FTS5). The index is built in the background at startup and updated shortly after saves, creates, renames, deletes and tree loads, and before each question; only files whose modification time or size changed are read again. Building it sends nothing anywhere. A damaged database is moved aside and rebuilt; a build without FTS5 answers questions with a `search_unavailable` error.
2. **A question** searches with its words (stop words dropped, each term quoted, so FTS5's syntax can't act) and the previous question's, ranks with bm25 (headings weighted above text), puts the open file's matches first (at most half of them) and its first section always, and keeps `chat.units` units within `chat.contextTokens`, cutting a longer one. A unit's section ID is kept only if the section index holds that ID in that file now.
3. **The model call** goes through the queue the summaries use, at interactive priority, counted against `summaries.concurrency`; it is never shared or cached, and stops when the request does. The prompt has the earlier turns (the last `chat.historyTurns` within `chat.historyTokens`) and the sources, each escaped inside its `<source>` tag. An answer stops at `chat.answerTokens` output tokens (default 4,000).
4. **Errors** after the stream starts are events: `rate_limited` for the provider's rate limit, `provider_error` with the provider's message otherwise.
5. **History.** A finished answer, or one stopped with some text (marked `stopped`), is appended to `.specquer/user/chat-history.yaml` (the `yaml` package, atomically, one write at a time, at most 200 turns); a failed one isn't. A file that isn't valid YAML is moved aside (`chat-history.yaml.damaged-<time>`); invalid turns are dropped one by one.

<a id="SPEC-00126" data-uid="p4xes0lj7wgt"></a>
## 12. Comment Threads

| Route | Behavior |
| ----- | -------- |
| `GET /api/comments?path=` | `{ available, threads, unusable? }`: a Markdown document's threads from its sidecar, each comment with its version. `available` is false for a file that isn't sectioned; `unusable` says why a sidecar can't be used. |
| `PATCH /api/comments?path=` | Body: one change (`add-thread`, `reply`, `edit` with `baseVersion`, `delete-comment`, `set-status`, `delete-thread`). Returns `{ ok: true, threads, created? }` or `{ ok: false, reason, threads, message }`. |

1. **Changes** are applied one at a time, each to the sidecar as it is on disk, by UIDs ([Data Architecture](data-architecture.md) §6.1). The last thread deleted removes the sidecar.
2. **The user's name** is Git's `user.name` for the root folder, else `user.email`, else the login name; it is read at most once a minute.
3. **Files.** Renaming a document renames its sidecar; deleting it deletes the sidecar, which the delete preview lists; creating or renaming a document onto a name with a leftover sidecar deletes that first. The file listing (Git or the walk) includes sidecars; the tree doesn't show them.
4. **Problems** (`GET /api/sections/problems`) include unusable and orphaned sidecars and detached threads.
