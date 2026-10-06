# Step 001 - Implementation Plan

_Plan for [Step 001 requirements](requirements.md): a simple Markdown file editor and browser. Drafted October 2026._

## 1. Summary

Step 001 turns the empty scaffolding into a working local tool: a Bun server, launched in a folder, serving a React UI with a file tree, file and folder rename and delete, a path breadcrumb with recent files, a front matter editor and four Markdown views (CodeMirror, split, preview, Milkdown), with autosave and UI state persisted in `.specquer/user/uistate.yaml`. It also hardens the localhost server, sets up the shared Markdown and UI-state domains, adds unit and browser tests, and adds seven specification documents.

The work is split into seven phases. Phase 0 is a set of short spikes to settle the riskiest technical questions before the main build. Sections 6 and 7 record the decisions and the answers to the open questions; all of them are settled, and the requirements have been updated to match.

## 2. Precedence and Conflicts

Step 001 takes precedence over earlier documents where they conflict. Known conflicts:

| Topic | Earlier document | Step 001 (wins) |
|---|---|---|
| YAML front matter | Not supported ([Ideas](/notes/ideas), Execution Context) | **Supported**, edited in its own CodeMirror area |
| UI state location | `.specquer/uistate.yaml` (Ideas) | `.specquer/user/uistate.yaml` |
| Browser back/forward history | Covers file changes and view-type changes (Ideas) | Not mentioned. **Dropped**: the idea is obsolete (Q4) |
| Markdown rendering library | react-markdown (Ideas) | Both "react-markdown" (Markdown Content) and "remark-react" (Technologies). **Decided (D3):** neither; a unified pipeline defined in `shared`, rendered with `hast-util-to-jsx-runtime`. The requirements have been updated |
| Front-end styling | None specified | Tailwind CSS, shadcn, a fixed palette, light and dark modes |
| File operations | None (Ideas) | Rename and delete for files and folders |
| Role of `shared` | API contract only ([technical architecture](/specifications/technical-architecture) §3–4) | Also the Markdown domain and the UI-state domain |
| Back-end routing | "Hono … replaces `Bun.serve()` routing" (technical architecture §5) | The code uses `Bun.serve()` for the client route and Hono for everything else; §5 needs correcting (Phase 6) |

## 3. Starting Point

- `server/src/index.ts`: `Bun.serve()` on port 3000, serving `client/index.html` at `/` and passing everything else to an empty Hono app. No security measures yet.
- `client/src/index.tsx`: a placeholder React component. No Tailwind, shadcn or editors.
- `shared/`: only a `package.json` with `hono`, `zod` and `@hono/zod-validator`; no source.
- `agent/`: LangChain placeholder. **Not used in Step 001.**
- No tests, no `bunfig.toml`, no `.specquer` handling.

## 4. Proposed Design

### 4.1 Package Responsibilities

| Package | New in Step 001 |
|---|---|
| `shared` | **API router and schemas** (`src/api/`): Hono routes under `/api` with Zod validation. **Workspace paths** (`src/paths/`): relative-path normalization and validation used by both sides. **Markdown domain** (`src/markdown/`): front matter split and join; the preview pipeline (D3) that turns Markdown text into an HTML syntax tree (hast) with remark-parse, remark-gfm, remark-frontmatter, remark-rehype and the raw-HTML handling of D15; and room for later syntax-tree work. It runs unchanged in the browser, in a Web Worker and on the server. **UI-state domain** (`src/uistate/`): Zod schema, defaults, versioning, pure update functions |
| `server` | Root-folder resolution, file-system service (tree, read, write, rename, delete) confined to the root, UI-state persistence with `Bun.YAML`, security middleware, launch (token, URL) |
| `client` | App shell, theme, tree, dialogs, breadcrumb, editors, autosave, typed API client (`hc`) |

`shared` must stay runnable in both the browser and Bun, so it cannot use `Bun.*` APIs. YAML parsing needed on the client side (for example to warn about invalid front matter) therefore needs a portable YAML library (see D6).

### 4.2 API Sketch (all under `/api`, defined in `shared`)

| Route | Purpose |
|---|---|
| `GET /api/tree` | Folder and `.md` file tree under the root (D9 decides filtering and laziness) |
| `GET /api/file?path=` | File text plus a **version** (content hash) |
| `PUT /api/file?path=` | Save text with the version it was based on; `409 Conflict` if the file changed on disk since (D8) |
| `POST /api/rename` | Rename a file or folder within its folder; a file keeps its `.md` extension; `409 Conflict` if the name is taken (Q8) |
| `DELETE /api/entry?path=` | Delete a file or folder (D10 decides the safety rules) |
| `GET /api/uistate`, `PATCH /api/uistate` | Read and update UI state |

The server deals in whole file text. Splitting into front matter and body happens in `shared` on the client, so the exact bytes of the file (line endings, trailing newline) are preserved on save.

### 4.3 UI-State Model (Sketch)

```ts
UiState = {
  version: 1,
  theme?: "light" | "dark",               // absent until the user chooses; then the browser preference applies
  treePaneFraction: number,              // left pane width as a fraction of the window
  expandedFolders: string[],             // relative paths
  recentFiles: string[],                 // most recent first, up to 10, excluding the current file;
                                         // persists across restarts; files opened from the tree or the dropdown
  currentFile?: string,
  files: Record<string, {                // keyed by relative path
    viewType: "text" | "split" | "preview" | "wysiwyg",
    frontmatterHeight?: number,          // drag-bar position
  }>,
}
```

Paths are relative to the root, using `/`. Renaming a file or folder in Specquer rewrites every affected entry (recent files, expanded folders, per-file settings, the current file), including entries for everything inside a renamed or deleted folder; deleting removes them. Entries for files that have disappeared some other way (for example deleted by an agent) are dropped when the state is loaded. If Specquer is open in several tabs or windows, the last write to `uistate.yaml` wins (Q13). Unknown or invalid content in `uistate.yaml` falls back to defaults rather than failing to start.

Per-user state must never be committed. When Specquer first creates `.specquer/user/`, it also writes `.specquer/user/.gitignore` containing a single `*`, which makes Git ignore everything in that folder, including the `.gitignore` itself. Specquer never overwrites an existing `.gitignore` there and never changes the repository's own `.gitignore` files. Files already committed under `.specquer/user/` stay tracked until someone removes them from Git; Specquer can warn about that but doesn't fix it.

### 4.4 Security Design

- **Listen only on the loopback interface** (`hostname: "127.0.0.1"`) and launch with an `http://127.0.0.1:<port>/` URL, which avoids `localhost` resolving to IPv6 first.
- **Session token.** Generated at startup (32 random bytes, base64url) and put in the launch URL (`/?token=…`). The first request with a valid token gets an `HttpOnly`, `SameSite=Strict` cookie and a redirect to the same URL without the token. Every `/api` request needs the cookie, or an `Authorization: Bearer` header for non-browser clients such as a future shell or agent.
- **Host check** on every request: only `127.0.0.1:<port>` and `localhost:<port>`, against DNS rebinding.
- **Origin check** on every state-changing request (`PUT`, `POST`, `PATCH`, `DELETE`): the `Origin` must be the server's own origin.
- **Path confinement.** Every path is validated in `shared`, resolved against the root, and checked with the real path (following symbolic links) to stay inside the root. `.git` and `.specquer` are never exposed or modified through the file API.
- **Rendering untrusted Markdown.** The files may contain raw HTML, and the page can write files, so cross-site scripting would mean arbitrary file writes. The preview pipeline (D3) handles raw HTML as decided in D15; if it is rendered at all, it goes through `rehype-sanitize` with a strict list of allowed tags and attributes. Milkdown's handling of raw HTML gets the same review. A **Content-Security-Policy** header is set on the HTML page (D11).

These rules go into the new `specifications/security.md`.

### 4.5 Command Line and Launch

Decided in answer to Q1:

```
specquer [root] [--port <n>] [--no-open]
```

- **`root`** (optional): the folder to work in, absolute or relative to the working directory. It defaults to the working directory. Specquer resolves it to a real path at startup and exits with an error if it doesn't exist or isn't a folder. The requirements have been updated to match.
- **Opening the browser.** Once the server is listening, Specquer opens the launch URL (with the session token) in the default browser: `open` on macOS, `xdg-open` on Linux, `cmd /c start "" <url>` on Windows, started with `Bun.spawn`. It always prints the URL too, so the user can open it by hand if no browser is available (for example over SSH or in a container), and a failure to open the browser is reported but isn't fatal.
- **`--no-open`** skips opening the browser. A future desktop shell (Tauri, Electrobun) or an agent would use it and read the URL from the output instead, in line with the requirement that the server shouldn't assume a browser tab.
- **Development mode.** `bun --hot` re-runs the server module on every change, which would open a new tab each time. Development mode therefore opens the browser at most once per process (guarded by a flag on `globalThis`), or not at all if `--no-open` is set in the `dev` script.
- **`--port`**: see D12.
- **Parsing** uses `parseArgs` from `node:util`, which Bun supports, so no argument-parsing dependency is needed.
- **Security note.** Passing the token-bearing URL to the opener command makes it briefly visible in the operating system's process list to other local users. This is acceptable for a single-user workstation tool and is recorded in `security.md`.

### 4.6 Theme and Colors

The requirements give each color a purpose (Q10). All colors live in **one** TypeScript module, `client/src/theme/palette.ts`, which produces CSS custom properties for both modes; Tailwind and shadcn read only those properties.

| Role | Light mode (given) | Used for |
|---|---|---|
| `text` | `#081f37` | Main document text |
| `background` | `#fafafa` | Document background |
| `secondary` | `#5fc9f3` | Secondary buttons and similar fills |
| `primary` | `#2e79ba` | Primary buttons and similar fills |
| `navigation` | `#1e549f` | Navigation, menus |
| `error` | `#cf4647` | Errors |
| `warning` | `#f5d061` | Warnings |

**Contrast check of the given colors** (WCAG 2 contrast ratios; AA needs 4.5:1 for normal text, 3:1 for large text and UI shapes):

| Pair | Ratio | Result |
|---|---|---|
| `text` on `background` | 15.95 | Passes |
| Light text `#fafafa` on `navigation` | 7.12 | Passes |
| Light text on `primary` | 4.41 | Just under 4.5 |
| Light text on `error` | 4.35 | Just under 4.5 |
| Light text on `secondary` | **1.81** | **Fails**; dark `text` on it gives 8.83 |
| Light text on `warning` | **1.43** | **Fails**; dark `text` on it gives 11.16 |

**Derivation mechanism.** The usual approach, and the one proposed here, works in the OKLCH color space, where lightness can be changed without shifting the hue:

1. **Text color on each fill is chosen automatically:** whichever of the mode's light and dark text colors contrasts more with the fill. This puts dark text on `secondary` and `warning`, as decided in D14.
2. **Small automatic nudges:** if the chosen text still falls under 4.5:1, the fill's lightness is moved in small steps, keeping its hue and chroma, until it passes. `primary` becomes `#2c77b8` and `error` `#cb4344`, differences too small to see.
3. **Dark mode:**
   - `background` takes the hue of `text` at very low lightness: `#031224`.
   - `text` becomes a near-white with the same hue: `#eaeff5`. Contrast: 16.28.
   - Accent fills keep their light-mode colors, with text chosen as in step 1. `navigation` is darkened (OKLCH lightness 0.30, giving `#092c5c`) so it reads as a surface rather than a bright block. Light text on it gives 11.90.
4. **A unit test** checks every text-on-fill pair in both modes against 4.5:1, so a palette change that breaks contrast fails the build.

The values above were computed while planning; the module recomputes them, so changing a light-mode color updates everything else. The light/dark choice follows the browser's `prefers-color-scheme` until the user picks one, which is then saved in `uistate.yaml` (Q11).

## 5. Phases

Each phase lists its tasks and what "done" means. Tests are written within each phase, not left to the end.

### Phase 0 - Spikes (settle risks first)

Short, throwaway experiments, each ending with a recorded decision:

1. **Tailwind and shadcn under Bun.** `bunfig.toml` with `bun-plugin-tailwind` for the dev server; shadcn components with the `@/` path alias in the `client` package (tsconfig paths, isolated installs); light and dark themes from CSS variables. *Done when* a shadcn button and dropdown render with Tailwind styles through `bun run dev`.
2. **Single executable with Tailwind.** The `bun build` CLI can't load plugins, so the release build must become a `build.ts` script calling `Bun.build({ compile: …, plugins: [tailwind] })`. *Done when* `bun run build` produces one executable that serves the styled client (D1).
3. **Milkdown round trip.** Load representative spec files (GFM tables, task lists, nested lists, code blocks, inline HTML anchors such as `<a name="r7k2"></a>`, reference-style links) into Milkdown and save them unchanged. Measure how much it rewrites. *Done when* D5 can be decided.
4. **Browser tests under Bun.** _Done while planning; see D7._ All three candidates passed the same test (clicks and typing into a `contenteditable` element) with Bun 1.4.2 on Linux and the system Chrome: `@playwright/test` under `bun --bun`, the `playwright` library inside `bun test`, and `Bun.WebView`.
5. **CodeMirror in Bun's bundle.** `@uiw/react-codemirror` (or plain CodeMirror 6) with `@codemirror/lang-markdown` and `@codemirror/lang-yaml`, including theming from the shared colors.

### Phase 1 - Foundations

- `shared`: package layout (`src/api`, `src/paths`, `src/markdown`, `src/uistate`), exports, unit tests.
- Path utilities: normalize, validate (no `..`, no absolute paths, no `.git` or `.specquer`), `.md` check.
- Markdown domain: `splitFrontmatter(text)` and `joinFrontmatter(frontmatter, body)` working on text so a round trip is byte-for-byte identical; the preview pipeline from D3 (text in, HTML syntax tree out), with tests that run it in Bun.
- UI-state domain: Zod schema, defaults, `version`, pure update functions (record a recent file, set view type, rename or delete paths).
- Server: command line and launch from §4.5 (root argument, opening the browser, `--no-open`, `--port`), security middleware from §4.4, launch output with the token URL, `uistate.yaml` read and write with `Bun.YAML`, creating `.specquer/user/.gitignore` with the folder (§4.3).
- *Done when* unit tests cover the shared domains and security checks, and requests without the token, with a wrong Host or a foreign Origin are rejected.

### Phase 2 - File-System API

- Tree listing, read, write with version check, rename, delete, all confined to the root.
- Write atomically (write to a temporary file, then rename) so a crash can't leave a half-written spec.
- Update UI state on rename and delete.
- *Done when* each route has tests against a temporary folder, including attempts to escape the root and conflicting saves.

### Phase 3 - App Shell and Left Pane

- Layout: resizable split pane (left fraction persisted); theme from §4.6 with the palette in one module; light/dark switch that follows the browser until the user chooses, then persists the choice.
- Tree view: folders and `.md` files, expand and collapse (persisted), single-click to open.
- Context menus on folders and files: Rename and Delete with shadcn dialogs (text box, "Rename"/"Delete" and "Cancel" buttons). Rename edits only the name: for files the `.md` extension is fixed and shown outside the text box. A name collision or an invalid name keeps the dialog open with an error in the error color.
- *Done when* the tree reflects the root folder and rename and delete work end to end, with UI state updated.

### Phase 4 - Right Pane

- **File path:** shadcn breadcrumb from the root, leading folders shown as "…" when space runs out; once another file has been opened, it becomes a dropdown of up to ten recent files (Q5).
- **Front matter:** CodeMirror with YAML highlighting, one line when the file has none and three lines otherwise, a drag bar with its height remembered per file, `---` delimiters hidden. Typing into the empty editor adds a front matter block on save; clearing it removes the block (Q7). No schema; invalid YAML is saved as typed, with only a warning-color marker (Q6).
- **Markdown content:** the four view types, persisted per file, default plain text:
  - plain text (CodeMirror, Markdown mode);
  - split (CodeMirror plus the preview);
  - preview (read-only);
  - WYSIWYG (Milkdown).
  One in-memory copy of the text is the single source of truth; switching views passes it between editors.
- **Preview rendering (D3):** a Web Worker runs the `shared` pipeline and returns the HTML syntax tree; the main thread turns it into React elements with `hast-util-to-jsx-runtime` and a component map (for example for links between documents). In the split view, renders are debounced (about 250 ms) and stale results are dropped. Measured while planning: parsing a 2,400-line spec takes ~78 ms of a ~100 ms render, the step the worker takes off the main thread.
- **Autosave:** before opening another file, when the tab loses focus (`visibilitychange`), and every 60 seconds if there are changes. Saves send the base version; a `409` shows a conflict message (D8). On page close, a final save is attempted with `fetch(…, { keepalive: true })`.
- *Done when* a file can be opened, edited in each view, switched between views and saved without unintended changes.

### Phase 5 - Component and End-to-End Tests

Unit tests are written in every phase. This phase adds the two browser-facing layers from D7:

- **Component tests** (`bun test` with happy-dom and React Testing Library): tree expand and collapse, context menus and dialogs (including rename validation), breadcrumb shortening and the recent-files dropdown, theme switching.
- **End-to-end tests** (Playwright on Bun, Chrome and WebKit): launch with token (and rejection without it), tree navigation, opening and editing in each view, view switching, autosave triggers, rename and delete end to end, UI state surviving a reload.
- Both run against a temporary root folder with fixture specs.
- *Done when* `bun test` runs the unit and component tests and one package script runs the end-to-end tests, both from the repository root.

### Phase 6 - Documentation

Required by Step 001:

- Update `specifications/technical-architecture.md` for the new technologies (Tailwind, shadcn, CodeMirror, Milkdown, the unified/remark/rehype preview pipeline with `hast-util-to-jsx-runtime`, `Bun.YAML`, the browser-test tool), the expanded role of `shared`, the `build.ts` release build and the corrected §5 routing description.
- Create `specifications/security.md`, `info-architecture.md`, `client-requirements.md`, `server-requirements.md`, `markdown-domain-design.md` and `uistate-domain-design.md`.
- Add all of them to the VitePress sidebar.

Also found while planning:

- `technical-architecture.md` contains paths like `` `../../mise.toml` ``, `` `../../bun.lock` `` and `` `../../client/index.html` `` that look like leftovers from the documentation reorganization; they should read `mise.toml`, `bun.lock`, `client/index.html` and so on.
- The sidebar entry "Step 001" links to `/work-items/step-001/todo`, which doesn't exist (see Q12).
- Update `CLAUDE.md` for the new commands (tests, release build) and conventions.

## 6. Decision Points

All decision points are decided: D3, D7 and D14 as described in each, the others as recommended. The phase each one affects is in brackets.

- **D1. Release build with Tailwind** [Phase 0]. _Decided: as recommended._ Replace the `bun build --compile` command with a `build.ts` that calls `Bun.build()` with `compile` and the Tailwind plugin (recommended, if the spike works); or pre-generate CSS with the Tailwind CLI and keep the command.
- **D2. shadcn setup** [Phase 0]. _Decided: as recommended._ Copy components into `client/src/components/ui` with the `@/` alias as the `bun init --react=shadcn` template does (recommended), or skip the shadcn CLI and add components by hand. Either way, shadcn brings Radix UI and `lucide-react` as dependencies.
- **D3. Markdown preview library** [Phase 4]. _Decided:_ option B, a pipeline defined in `shared` (`unified`, `remark-parse`, `remark-gfm`, `remark-frontmatter`, `remark-rehype`, plus the raw-HTML handling of D15) that produces an HTML syntax tree, rendered in the client with `hast-util-to-jsx-runtime`. Reasons: the Markdown logic lives in `shared` as the requirements ask; parsing, about 80% of the render cost, can run in a Web Worker so typing in the split view stays smooth; the server can reuse the pipeline later. react-markdown (option A) would have been quicker to start, but accepts only a string and parses on the main thread on every render; `remark-react` is deprecated, and `rehype-react` is a thin wrapper around `hast-util-to-jsx-runtime`. The requirements have been updated to match.
- **D4. CodeMirror wrapper** [Phase 4]. _Decided: as recommended._ `@uiw/react-codemirror` (quicker) or a small wrapper around plain CodeMirror 6 (more control over the shared document and fewer re-renders). Recommended: plain CodeMirror 6, since two editors (front matter and body) and view switching need careful state handling.
- **D5. Milkdown fidelity policy** [Phase 0/4]. _Decided: as recommended._ If the spike shows Milkdown rewrites unchanged Markdown: (a) accept it and document it; (b) only write Milkdown's output when the user actually changed something; (c) mark WYSIWYG as experimental. Recommended: (b) as a minimum, plus (c) if rewrites affect constructs used for traceability.
- **D6. YAML in shared code** [Phase 1]. _Decided: as recommended._ `Bun.YAML` only works on the server. For front matter validation in the browser, use the `yaml` package in `shared` (recommended), or validate only on the server when saving.
- **D7. Browser-test tool** [Phase 0/5]. _Decided:_ three layers.
  1. **Unit tests** with `bun test`.
  2. **Component tests** with `bun test`, happy-dom and React Testing Library (as Bun's documentation recommends), for components that don't need layout or real text editing.
  3. **End-to-end tests** with Playwright's test runner on the Bun runtime: `bun --bun x playwright test`. Without `--bun` it silently runs on Node if Node is installed, so the flag is fixed in the package script. Running Playwright on Bun isn't, as far as known, officially supported by Playwright; if it breaks, the fallback is the `playwright` library inside `bun test`. `Bun.WebView` is worth revisiting once it's no longer experimental.

  Details: locally, use the installed Chrome (`channel: "chrome"`) to avoid downloading browsers; also run the end-to-end tests on WebKit, the engine of a future desktop shell on macOS and Linux. `bun test` also picks up `*.spec.ts` files, so Playwright specs live in their own folder (for example `e2e/`) that `bunfig.toml` keeps out of `bun test`. The requirements have been updated to match.
- **D8. Conflicts with external edits** [Phase 2/4]. _Decided: as recommended._ Coding agents and other editors change files while they're open. Recommended: version check on save (`409` on mismatch; this also catches the same file being saved from two tabs, since "last write wins" (Q13) applies only to UI state), then a dialog offering "reload theirs" or "keep mine". File watching and live reload are left for a later step.
- **D9. Tree contents** [Phase 2]. _Decided: as recommended._ Which folders to skip (`.git`, `.specquer`, `node_modules`, `.gitignore` entries?), whether folders without any `.md` files are shown, and whether the tree loads all at once or folder by folder. Recommended: skip `.git`, `.specquer` and `node_modules`; respect `.gitignore`; hide folders with no `.md` files; load all at once with a size limit.
- **D10. Delete safety** [Phase 2]. _Decided: as recommended._ Only `.md` files are shown, so deleting a folder could silently remove hidden files (images, code, untracked work). Options: refuse folders containing anything other than `.md` files; list everything that will be deleted in the dialog; or move to the operating system's trash. Recommended: the dialog lists what will be deleted, including hidden files, and warns about files not committed to Git.
- **D11. Content-Security-Policy** [Phase 1]. _Decided: as recommended._ CodeMirror and Milkdown inject styles, and development mode uses a WebSocket for hot reloading. Recommended: `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `connect-src 'self'` plus the WebSocket in development, `object-src 'none'`, `frame-ancestors 'none'`.
- **D12. Port** [Phase 1]. _Decided: as recommended._ Development stays on 3000. For the release executable, one fixed port prevents running Specquer in two repositories at once. Recommended: try a default port and fall back to a free one, with a `--port` option.
- **D13. Scope of the Markdown domain** [Phase 1]. _Decided: as recommended._ Step 001 only needs front matter split and join and the preview pipeline. Building the heading/section tree now would prepare for summaries and traceability but isn't required. Recommended: front matter and pipeline now; section tree in a later step.
- **D14. Text on the `secondary` and `warning` colors** [Phase 3]. _Decided:_ option (a), dark text on `secondary` and `warning`, chosen automatically (§4.6). Light text on `secondary` (`#5fc9f3`) would reach only 1.81:1. The requirements have been updated to match.
- **D15. Raw HTML in the preview** [Phase 4]. _Decided: as recommended._ Files may contain raw HTML, such as the traceability anchors `<a name="r7k2" data-status="draft"></a>` from the [traceability note](/notes/traceability-links). Tested while planning with react-markdown's pipeline, which B shares: by default the HTML is **shown as literal text** inside headings; skipping it removes the anchors; `rehype-raw` with `rehype-sanitize` renders a real, invisible anchor and strips dangerous attributes such as `onerror`. The sanitizer renames `name="r7k2"` to `user-content-r7k2` against DOM clobbering, as GitHub does, so in-page links need the same prefix. Recommended: `rehype-raw` plus `rehype-sanitize` with a strict list of allowed tags and attributes (including `a[name]` and `data-*`), and links to `#id` rewritten to `#user-content-id`.

## 7. Open Questions

1. **Root folder override.** _Resolved:_ an optional `root` argument (defaulting to the working directory) is supported, and Specquer opens the browser automatically on launch, with `--no-open` to skip it. See §4.5.
2. **`.specquer` and Git.** _Resolved:_ Specquer creates `.specquer/user/.gitignore` containing `*` when it creates the folder, so per-user state is never committed. See §4.3.
3. **The empty "Breadcrumbs" section.** _Resolved:_ the File Path section is the whole requirement; the empty heading has been removed from the requirements.
4. **Browser history.** _Resolved:_ the back/forward navigation idea is obsolete and dropped; it is not planned for any step.
5. **Recent files.** _Resolved:_ the list persists across restarts in `uistate.yaml` and includes files opened from the dropdown or the left pane; renames and deletes clean up the old entries. See §4.3. (Assumed, not yet confirmed: entries for files deleted or renamed outside Specquer are dropped when the state is loaded.)
6. **Invalid front matter.** _Resolved:_ invalid YAML is kept and saved as typed; there is no schema. Specquer only shows a warning marker.
7. **Adding and removing front matter.** _Resolved:_ yes. Typing into the empty editor adds a `---` block; clearing it removes the block.
8. **Rename scope.** _Resolved:_ rename never moves; the extension can't change; a name collision keeps the dialog open with an error.
9. **Right pane layout.** _Resolved:_ yes, three stacked rows: path, front matter, content.
10. **Theme mapping.** _Resolved:_ the requirements now give each color a purpose; dark mode is derived automatically in OKLCH. See §4.6; D14 settled the text color on `secondary` and `warning`.
11. **Theme persistence.** _Resolved:_ the first launch follows the browser's preference; the user's choice is saved in `uistate.yaml`.
12. **Work-item navigation.** _Resolved:_ "Step 001" now lists `requirements.md` and this plan in the sidebar, and the top navigation's "Work Items" opens the requirements.
13. **Multiple windows.** _Resolved:_ last write wins for `uistate.yaml`. File saves still use the version check (D8).

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Milkdown rewrites Markdown it didn't change | Noisy Git diffs; damaged traceability markers later | Spike in Phase 0; D5 |
| Bun's bundler plugin limits (Tailwind in the release build) | No single executable with styles | Spike in Phase 0; D1 |
| Playwright's runner stops working on Bun (not officially supported) | End-to-end tests fall back to Node, or stop | Pinned versions; fallback to the `playwright` library inside `bun test` (D7) |
| Bun 1.4 is a new major internal rewrite (see the [platform note](/notes/platform-choice)) | Regressions in the runtime | Pinned version; tests catch regressions on upgrade |
| Cross-site scripting through rendered Markdown | Arbitrary file writes | No raw HTML rendering, sanitizing if enabled, CSP, token and Origin checks |
| Deleting folders with hidden files | Lost work | D10 |
| Autosave overwriting an agent's changes | Lost work | Version check (D8) |

## 9. Implementation Notes

Recorded while implementing the plan (October 2026).

### 9.1 Spike Results (Phase 0)

1. **Tailwind and shadcn under Bun:** works. `server/bunfig.toml` loads `bun-plugin-tailwind` for the development server. The shadcn components were copied by hand into `client/src/components/ui` (D2), using the unified `radix-ui` package, with the `@/` alias in `client/tsconfig.json`, which Bun's bundler also reads.
2. **Single executable with Tailwind:** works (D1). `server/build.ts` calls `Bun.build()` with `compile` and the Tailwind plugin; `bun run build` produces one executable (about 80 MB) that serves the styled client.
3. **Milkdown round trip:** Milkdown rewrites unchanged Markdown: `-` bullets become `*` (configurable, now set back to `-`), table separator rows are re-padded, reference-style links become inline links and their definitions disappear, and `___` becomes `***`. Inline HTML anchors such as `<a name="r7k2"></a>` survive, so traceability markers aren't affected. D5 is applied as option (b): Milkdown's output is used only after the user edits in it; option (c) wasn't needed.
4. **Browser tests under Bun:** as found while planning (D7). Two further findings: happy-dom replaces Bun's `fetch`, `Request` and `Response` when registered globally, which breaks the server tests that `bun test` runs in the same process, so the preload restores Bun's versions; and Playwright's WebKit needs system libraries (`libmanette`) that must be installed with `sudo`.
5. **CodeMirror in Bun's bundle:** works, as plain CodeMirror 6 with a small wrapper (D4), themed through the palette's CSS custom properties so light and dark mode need no rebuild.

### 9.2 Findings

- **Web Workers aren't bundled.** Bun's HTML bundling leaves `new Worker(new URL("./worker.ts", import.meta.url))` untouched, so the worker loads in development but not in production. The server now builds the preview worker with `Bun.build()` and serves it at `/_specquer/preview-worker.js`; the release build embeds it. The worker build needs the `worker` export condition, because the browser build of `decode-named-character-reference` (used by micromark) uses `document`.
- **Bun's HTML routes can't set headers.** The page therefore goes through Hono: Bun serves the bundled page at an internal path, and Hono's `/` handler checks the session, fetches the page and adds the Content-Security-Policy. The CSP allows the development server's inline script by its hash.
- **Two servers on one port.** Without `reusePort: false`, a second Specquer could bind the busy default port and share its connections instead of falling back to a free one. Found by the parallel end-to-end tests.
- **Development mode and file watchers.** Many development-mode servers at once run out of file watchers (`EMFILE`), so the end-to-end tests run Specquer in production mode.
- **Dark mode colors** come out slightly different from the values in §4.6 (background `#05101d`, text `#ebeff4`, navigation `#002b63`), and `primary` and `error` take dark text in dark mode, because the module picks whichever text color contrasts more. All pairs pass 4.5:1.
