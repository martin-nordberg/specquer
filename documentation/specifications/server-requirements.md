# Specquer Server Requirements

Requirements for the back end (`server/`). They come from [Step 001](/work-items/step-001/requirements) and its [implementation plan](/work-items/step-001/implementation-plan). Security is specified separately in [Security](security.md).

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

1. Only `.md` files are listed (case-insensitive extension), with the folders that contain them, directly or further down. Folders without Markdown files are left out.
2. `.git`, `.specquer` and `node_modules` are never listed.
3. In a Git work tree, the list comes from `git ls-files --cached --others --exclude-standard`, so `.gitignore` rules (including nested ones and global excludes) apply. Tracked files deleted from disk are left out.
4. Outside a Git work tree, the server walks the folders itself; no ignore rules apply then.
5. The tree is loaded in one request. It holds at most 10,000 files; beyond that it is cut off and marked as truncated.
6. Folders come before files; names sort naturally, ignoring case.

## 4. Files

| Route | Behavior |
| ----- | -------- |
| `GET /api/file?path=` | Returns the file's text and its **version** (SHA-256 of its bytes). |
| `PUT /api/file?path=` | Body `{ text, baseVersion }`. Writes the text if the file's current version equals `baseVersion`; otherwise answers `409` with the current version and writes nothing. Returns the new version. |
| `POST /api/rename` | Body `{ path, newName }`. Renames a file or folder within its folder. `409` if the name is taken. Returns the new path and the updated UI state. |
| `GET /api/entry/delete-preview?path=` | Lists the files a delete would remove (up to 500, with the total count) and those not committed to Git, or `null` outside Git. |
| `DELETE /api/entry?path=` | Deletes a file or a folder with everything in it. Returns the updated UI state. |

1. All paths are workspace paths, validated and confined to the root as specified in [Security](security.md) §5. Invalid paths answer `400`, missing entries `404`, paths leading outside the root `403`.
2. Only existing `.md` files can be read or written; the API doesn't create files. Files must be UTF-8; others answer `415`. A byte-order mark is kept.
3. The server deals in whole file text, byte for byte: splitting into front matter and body happens in the client, so line endings and the trailing newline are preserved.
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

The model is specified in [UI-State Domain Design](uistate-domain-design.md).

## 6. Other Routes

| Route | Behavior |
| ----- | -------- |
| `GET /` | The client page (see [Security](security.md) §3 for the token exchange and §7 for its headers). |
| `GET /_specquer/preview-worker.js` | The bundled preview Web Worker ([Technical Architecture](technical-architecture.md) §7.3). |
| Bundled client assets | Served by `Bun.serve()`'s routes. |
