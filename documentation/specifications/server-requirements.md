# Specquer Server Requirements

Requirements for the back end (`server/`). They come from [Step 001](/work-items/step-001-doc-editing/requirements) and its [implementation plan](/work-items/step-001-doc-editing/implementation-plan), and [Step 002](/work-items/step-002-sections/requirements) (sections). Security is specified separately in [Security](security.md).

## 1. Command Line

```
specquer [root] [--port <n>] [--no-open]
```

1. **`root`** (optional): the folder to work in, absolute or relative to the working directory; it defaults to the working directory. Specquer resolves it to its real path at startup and exits with an error (exit code 2) if it doesn't exist or isn't a folder.
2. **`--port <n>`**: listen on this port, and fail if it is taken. Without it, Specquer tries port 4870 and falls back to a free port, so it can run in several folders at once.
3. **`--no-open`**: don't open a browser. For a future desktop shell or a coding agent, which read the URL from the output instead.
4. Arguments are parsed with `parseArgs` from `node:util`. Unknown options or more than one root are errors.

## 2. Launch

1. The server listens on `127.0.0.1` only.
2. Once listening, it prints the root folder and the launch URL, `http://127.0.0.1:<port>/?token=<token>`.
3. Unless `--no-open` is given, it opens the launch URL in the default browser: `open` on macOS, `xdg-open` on Linux, `cmd /c start "" <url>` on Windows. Failure to open a browser is reported but not fatal.
4. Under `bun --hot` (development) the token is kept and the browser is opened at most once per process.
5. The development command (`bun run dev`) serves the repository itself on port 3000.

## 3. File Tree

`GET /api/tree` returns the folders and Markdown files under the root.

1. Only `.md` files are listed (case-insensitive extension), with the folders that contain them, directly or further down. Empty folders (holding no files, only other empty folders if any) are listed too, so a folder created through the API shows. Other folders without Markdown files are left out.
2. `.git`, `.specquer` and `node_modules` are never listed.
3. In a Git work tree, the list comes from `git ls-files --cached --others --exclude-standard`, so `.gitignore` rules (including nested ones and global excludes) apply. Tracked files deleted from disk are left out. Git doesn't list empty folders, so the server also asks it for untracked folders that aren't ignored (`git ls-files --others --exclude-standard --directory`) and walks those to find the empty ones.
4. Outside a Git work tree, the server walks the folders itself; no ignore rules apply then.
5. The tree is loaded in one request. It holds at most 10,000 files, and walks of the file system stop after 100,000 entries; beyond either limit it is cut off and marked as truncated.
6. Folders come before files; names sort naturally, ignoring case.
7. Each tree load also starts a background scan of the sectioned files (§7), which writes nothing.

## 4. Files

| Route | Behavior |
| ----- | -------- |
| `GET /api/file?path=` | Returns the file's text and its **version** (SHA-256 of its bytes). |
| `PUT /api/file?path=` | Body `{ text, baseVersion }`. Writes the text if the file's current version equals `baseVersion`; otherwise answers `409` with the current version and writes nothing. Returns the new version. For a sectioned file, the anchors are added and corrected first (§7) and the response also carries `edits`, relative to the body sent. |
| `POST /api/create` | Body `{ parent, name, kind }` (`kind` is `file` or `folder`; `parent` is `""` for the root). Creates an `.md` file or an empty folder in `parent`, which must be an existing folder. A new file is empty, or holds its root anchor if it is sectioned. `409` if the name is taken. Answers `201` with the new path. |
| `POST /api/rename` | Body `{ path, newName }`. Renames a file or folder within its folder. `409` if the name is taken. Returns the new path and the updated UI state. |
| `GET /api/entry/delete-preview?path=` | Lists the files a delete would remove (up to 500, with the total count) and those not committed to Git, or `null` outside Git. |
| `DELETE /api/entry?path=` | Deletes a file or a folder with everything in it. Returns the updated UI state. |

1. All paths are workspace paths, validated and confined to the root as specified in [Security](security.md) §5. Invalid paths answer `400`, missing entries `404`, paths leading outside the root `403`.
2. Only existing `.md` files can be read or written; `PUT /api/file` doesn't create files. New files are created through `POST /api/create`, whose name must end in `.md`, and never replace an existing file or folder. Files must be UTF-8; others answer `415`. A byte-order mark is kept.
3. The server deals in whole file text, byte for byte: splitting into front matter and body happens in the client, so line endings and the trailing newline are preserved. The one exception is a sectioned file, whose anchors the server adds and corrects (§7), keeping its line endings, front matter and byte-order mark.
4. Writes are atomic: the text is written to a temporary file in the same folder, given the original's permissions, and renamed over the original.
5. A file can only be renamed to a name with the same extension. A case-only rename works on case-insensitive file systems.
6. "Not committed" means new, modified, deleted or ignored according to `git status --porcelain --untracked-files=all --ignored=matching`.
7. Errors are JSON: `{ error, message }`.

## 5. UI State

| Route | Behavior |
| ----- | -------- |
| `GET /api/uistate` | Returns the stored UI state. |
| `PATCH /api/uistate` | Merges the given top-level fields into the stored state (`null` clears `theme` or `currentFile`) and returns the result. |

1. The state is stored in `.specquer/user/uistate.yaml` under the root, read and written with `Bun.YAML`, atomically.
2. When the server creates `.specquer/user/`, it also writes `.specquer/user/.gitignore` containing `*`. It never overwrites an existing `.gitignore` there and never changes the repository's own `.gitignore` files.
3. Invalid or unknown content falls back to defaults, field by field; it never stops the server.
4. Entries for files and folders that no longer exist are dropped whenever the state is read or updated.
5. Renames and deletes through the API update the stored state in the same request.
6. Updates are applied one at a time. Across tabs and windows, the last write wins.

The model is specified in [Data Architecture](data-architecture.md) §3.

## 6. Sections

| Route | Behavior |
| ----- | -------- |
| `GET /api/sections?path=` | The sections of one document, for badge tooltips: ID, UID (`null` for a duplicate), kind, title and heading level. |
| `GET /api/sections/search?q=&limit=&path=` | Sections whose ID or title starts with (or else contains) `q`, across documents or in the document at `path`, for link completion; at most `limit` (default 50, at most 200). |
| `POST /api/sections/anchor` | Body `{ folder, dryRun }`. **Add section anchors**: returns the sectioned files under the folder whose anchors would change, and unless `dryRun` changes them. |

## 7. Section Anchors and Data Files

1. Which files are sectioned, and the prefix for their new sections, comes from `.specquer/shared/section-prefixes.config.yaml`; without it no file is sectioned.
2. The server keeps an index of the sectioned files and of `.specquer/shared/documents.yaml` and `.specquer/shared/<prefix>/sections.yaml`. It is brought up to date in the background at startup and after each tree load, by reading only files whose modification time or size changed. This never writes a file.
3. Section IDs are allocated on the server only, one update at a time, so two tabs can never get the same number. Numbers are never reused.
4. Documents and data files are written only when the user changes something: saving, creating, renaming or deleting through the API, and **Add section anchors**. The data files then hold the whole reconciled state.
5. Renames and deletes update the paths in `documents.yaml`, and drop the documents (and their sections) that are gone or no longer match the configuration.
6. Data files are written atomically and only when their content changes; damaged or conflicted data files never stop the server.

The model, recognition rules, data files and conflict rules are specified in [Data Architecture](data-architecture.md) §2.

## 8. Other Routes

| Route | Behavior |
| ----- | -------- |
| `GET /` | The client page (see [Security](security.md) §3 for the token exchange and §7 for its headers). |
| `GET /_specquer/preview-worker.js` | The bundled preview Web Worker ([Technical Architecture](technical-architecture.md) §7.3). |
| Bundled client assets | Served by `Bun.serve()`'s routes. |
