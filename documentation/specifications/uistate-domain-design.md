# UI-State Domain Design

The UI state is the per-user state of the Specquer interface. The client reads and changes it; the server stores it. Its model lives in `shared/src/uistate/` (`@specquer/shared/uistate`) so both sides apply the same rules.

## 1. Storage

- File: `.specquer/user/uistate.yaml` under the root folder, written by the server with `Bun.YAML`, atomically.
- `.specquer/user/` gets a `.gitignore` containing `*` when Specquer creates the folder, so the state is never committed.
- Several tabs or windows may change it; the last write wins.

## 2. Model

```ts
UiState = {
  version: 1,
  theme?: "light" | "dark",      // absent until the user chooses; the browser's preference applies
  treePaneFraction: number,      // folder pane width, 0.1 to 0.7 of the window; default 0.25
  expandedFolders: string[],     // workspace paths
  recentFiles: string[],         // most recent first, at most 10, never the current file
  currentFile?: string,          // the open file
  files: Record<string, {        // keyed by workspace path
    viewType: "text" | "split" | "preview" | "wysiwyg",   // default "text"
    frontmatterHeight?: number,  // front matter editor height in pixels
  }>,
}
```

All paths are workspace paths: relative to the root, separated by `/`.

## 3. Parsing

`parseUiState(value)` turns whatever was stored into a valid state:

- Each field falls back to its default on its own, so one damaged field doesn't lose the rest.
- Unknown fields are dropped; non-string paths and duplicates are removed; the recent files are cut to ten; per-file entries that aren't objects are dropped, and an invalid view type becomes `"text"`.
- A file that isn't YAML at all gives the defaults. Specquer never fails to start because of the UI state.

## 4. Updates

Every change is a pure function from state to state:

| Function | Effect |
| -------- | ------ |
| `openFile(state, path)` | Makes `path` current; the previous current file moves to the front of the recent files; `path` leaves them |
| `closeFile(state)` | No current file; the previous one joins the recent files |
| `setViewType`, `setFrontmatterHeight` | Per-file settings |
| `setTheme`, `setTreePaneFraction` (clamped), `setFolderExpanded` | Global settings |
| `renameInUiState(state, from, to)` | Rewrites every entry for `from` and everything inside it: expanded folders, recent files, current file, per-file settings |
| `deleteInUiState(state, path)` | Removes every entry for `path` and everything inside it |
| `pruneMissing(state, kindOf)` | Removes entries for files and folders that no longer exist, for example deleted by a coding agent |
| `diffUiState(a, b)`, `applyUiStatePatch(state, patch)` | The top-level fields that changed, and applying them |

## 5. Client and Server

- **Client:** `UiStateStore` holds the state, applies changes at once and sends the changed top-level fields as a `PATCH` 300 ms later (and at once when the tab is hidden or the page closes). Before a rename or delete it sends pending changes, and afterwards it takes the state the server returns. Creating a file or folder doesn't involve the server's state: the client expands the folder it was created in and opens a new file through ordinary updates.
- **Server:** `UiStateStore` reads the file for every request, applies the change, drops entries for vanished paths and writes the file, one update at a time. Renames and deletes through the API update the state in the same request, after the file-system change, so the old paths can still be matched.

## 6. Versioning

`version` is 1. A later change to the model raises it; `parseUiState` will then migrate older content, and anything it can't migrate falls back to defaults as above.
