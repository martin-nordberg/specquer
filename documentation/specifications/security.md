<a id="SPEC-00062" data-uid="t34ybwudslp2"></a>

<a id="SPEC-00063" data-uid="hcx5vkka0808"></a>
# Specquer Security

Specquer is a local web server that can read, write, rename and delete files under its root folder. Anything that can talk to it can do the same, so the server is protected against other websites in the user's browser, other machines on the network and malicious content in the Markdown files themselves.

The rules below are implemented in `server/src/security.ts`, `server/src/files.ts`, `server/src/instance.ts`, `server/src/summaries/`, `server/src/chat/`, `server/src/settings/` and the shared preview pipeline, and are covered by unit tests (`server/src/security.test.ts`, `server/src/files.test.ts`, `server/src/settings/settings.test.ts`, `server/src/settings/settings-api.test.ts`, `server/src/instance.test.ts`, `shared/src/markdown/preview.test.ts`, `shared/src/markdown/highlight.test.ts`, `shared/src/paths/paths.test.ts`, `shared/src/markdown/answer.test.ts`, `agent/src/chat.test.ts`) and end-to-end tests (`e2e/launch.spec.ts`, `e2e/views.spec.ts`, `e2e/settings.spec.ts`, `e2e/all-files.spec.ts`).

<a id="SPEC-00064" data-uid="iqgf4njjhp4m"></a>
## 1. Threats

| Threat | Example | Protection |
| ------ | ------- | ---------- |
| Network access | Another machine on the same network calls the API | Listen on loopback only (§2) |
| Cross-site requests | A website the user visits sends `fetch("http://127.0.0.1:4870/api/...")` | Session token (§3), Origin check (§4) |
| DNS rebinding | A website makes its own host name resolve to `127.0.0.1` and reads the API as same-origin | Host check (§4) |
| Path traversal | `GET /api/file?path=../../.ssh/id_rsa.md`, or a symbolic link out of the root | Path confinement (§5) |
| Cross-site scripting through Markdown | A spec contains `<img src=x onerror="fetch('/api/entry?path=docs', {method: 'DELETE'})">` | Sanitizing (§6), Content-Security-Policy (§7) |
| Lost work | Autosave overwrites a file a coding agent just changed; deleting a folder removes files the tree doesn't show | Version check on save; delete preview (§8) |
| Specs sent to a third party | Summaries send section text to a model provider | Opt-in configuration, saved text only, keys only in the environment (§9) |
| Prompt injection | A spec tells the model to answer with a link or HTML, or to ignore its instructions | Summaries rendered as plain text; chat answers as limited Markdown whose only links are checked citations; sources escaped in the prompt; all labeled as AI-generated (§9) |

<a id="SPEC-00065" data-uid="q5dau5z14uck"></a>
## 2. Network

- The server listens on `127.0.0.1` only, never on all interfaces.
- The launch URL uses `http://127.0.0.1:<port>/`, which avoids `localhost` resolving to IPv6 first.
- The server sets `reusePort: false`, so a second Specquer can't bind the same port and share its connections; it falls back to a free port instead.

<a id="SPEC-00066" data-uid="atxgrltcqpql"></a>
## 3. Session Token

- At startup the server generates a token: 32 random bytes, base64url-encoded. Under `bun --hot` it is kept for the life of the process.
- The launch URL carries it: `/?token=<token>`. A request with a valid token gets a cookie and a `303` redirect to `/`, which drops the token from the address bar and history.
- The cookie is `HttpOnly` and `SameSite=Strict`. Its name includes the port (`specquer_session_<port>`), because cookies are shared between ports on the same host and several Specquers may run at once.
- Every `/api` request needs the cookie, or an `Authorization: Bearer <token>` header for non-browser clients (a future desktop shell or coding agent). Without either the API answers `401`.
- The page at `/` also needs the cookie; without it the server answers `401` with a short explanation.
- Tokens are compared in constant time.
- **Known exposure:** opening the browser passes the launch URL, token included, to the operating system's opener (`xdg-open`, `open`, `start`), so it is briefly visible in the process list to other local users. This is acceptable for a single-user workstation tool. `--no-open` avoids it.
- **The instance file:** the launch URL, token included, is also stored in `.specquer/user/instance.json` while Specquer runs, so a second launch on the same root can hand over to it (Server Requirements §2). The file is created readable and writable by its owner only (mode `0600`; Windows ignores the mode, leaving the folder's permissions), is ignored by Git, is out of reach of the file API (§5), and is deleted on a clean exit. A program running as the same user could read it, but such a program can already read and write the specs.

<a id="SPEC-00067" data-uid="dcqj07fp73a2"></a>
## 4. Host and Origin Checks

- **Host:** every request handled by Hono must have a `Host` header of `127.0.0.1:<port>` or `localhost:<port>`; anything else gets `403`. This defeats DNS rebinding, where the browser would send the attacker's host name.
- **Origin:** every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) must have an `Origin` of `http://127.0.0.1:<port>` or `http://localhost:<port>`. A request authenticated with a bearer token may omit `Origin`; one authenticated by cookie may not.
- API responses carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- **Limitation:** the bundled client's scripts and stylesheets are served by `Bun.serve()`'s routes, which bypass Hono, so the Host check doesn't cover them. They contain only the public client code, never user data.

<a id="SPEC-00068" data-uid="elbjr28seyhr"></a>
## 5. Path Confinement

- Every path the API receives is validated by the shared path rules: relative to the root, `/`-separated, no `..`, no absolute or drive paths, no backslashes or control characters, and no `.git` or `.specquer` segment in any case (on case-insensitive file systems, the default on macOS and Windows, `.GIT` is `.git`).
- The server resolves the path against the root and checks the **real** path (after following symbolic links) stays inside the root and outside `.git` and `.specquer`, so a symbolic link in the root can't lead into them either. For rename and delete, which act on the entry itself, the real path of its folder must pass the same check, so a symbolic link is renamed or deleted, never its target.
- Reading through `GET /api/file` and writing are limited to existing `.md` files that are UTF-8 text.
- **Showing other files** ([Step 014](/work-items/step-014-all-files/requirements)). `GET /api/view` and `GET /api/image` read, never write, any file the **All Files** listing holds. Their paths follow the same rules, except that they may lie in the root's `.specquer/shared/` (exactly that case), which is committed and so exposes nothing new; the real path is checked the same way, and must not lead into `.git`, `node_modules`, the rest of `.specquer`, or outside the root. A path the listing doesn't hold answers `404`, as if it didn't exist: that keeps out files `.gitignore` hides, which is where secrets such as `.env` usually are, `.specquer/user/` (which holds the session token) and `.specquer/cache/`.
- **The token's reach grows with Step 014.** Before it, a request with the session token could read only Markdown files; now it can read every listed file under the root, source code and configuration included. What it can write, rename and delete doesn't change: Markdown files and folders only (a file of another kind answers `400`), so a stolen token still can't change code. Outside a Git work tree there is no `.gitignore` to apply, so every file under the root except the excluded folders can be read; a root holding secrets outside Git should keep them elsewhere.
- Creating is limited to an `.md` file (empty, holding only its root section anchor, or, for the root folder's `AGENTS.md` on request, holding only the agent guide) or an empty folder, named by the same name rules, inside an existing folder whose real path is inside the root. It never overwrites: an existing file, folder or symbolic link of that name answers `409`.
- Rename changes only the name within the same folder; the new name is validated the same way and a file must be Markdown and keep its extension. Delete acts on Markdown files and folders only.
- The root folder itself can't be renamed or deleted.
- `.specquer/` stays out of reach of the file API. The server itself writes the section data files, `.specquer/shared/<prefix>/sections.yaml`, at fixed paths: a prefix is a folder name only if it matches `[A-Z][A-Z0-9]{1,4}`, so it can't name another folder. To tell an original from a copy, the server runs `git ls-files --cached` on the two paths (as literal pathspecs), which reads Git's index and changes nothing.
- The server reads each folder's `.specquer-config.yaml` (the folder configuration) in the folders the tree listing visits, and each prefix's `.specquer/shared/<prefix>/prefix.config.yaml` (its allowed statuses) at the same fixed paths as the data files; it never writes the latter. Statuses go into anchors only as `data-status="…"`, and an allowed value can't hold `"`.
- The settings routes (Step 006) and creating a folder write only `.specquer/shared/agent.config.yaml`, `.specquer/user/agent.config.yaml` and a folder's `.specquer-config.yaml`, and only the settings in their schemas; other keys in those files are kept as they are. A request never names one of these files: the folder settings take a folder path, confined like every path and required to be an existing folder whose real path is inside the root. The folder's file has a fixed name, is written atomically, may be deleted when left empty, and is never read or written when it is a symbolic link. It is the only file outside `.specquer/` the server writes that isn't Markdown.

<a id="SPEC-00069" data-uid="mxun8hb7jbnj"></a>
## 6. Rendering Untrusted Markdown

Spec files may contain raw HTML (traceability anchors such as `<a name="r7k2" data-status="draft"></a>`). Since the page can write files, script in a spec would be able to write files too.

- The preview pipeline parses raw HTML with `rehype-raw` and then sanitizes it with `rehype-sanitize`, using GitHub's list of allowed tags and attributes plus `data-*` attributes on `a` and `span`, except `data-section-anchor`, which only the pipeline sets (so HTML in a spec can't make a section badge, whose menu acts on a real section). Scripts, event handlers, `iframe`, `object`, `style` and `javascript:` URLs are removed.
- The sanitizer prefixes `id` and `name` values with `user-content-` against DOM clobbering, as GitHub does; in-page links (`#id`) are rewritten to match.
- The preview is rendered to React elements, never with `innerHTML`.
- Milkdown (the WYSIWYG view) shows raw HTML as text and doesn't render it. Only section anchors are shown differently, as a badge image Specquer draws itself; their attributes are never put into the page as HTML.
- Section badges show the section ID and paths as text, never as HTML.
- **Highlighted code** ([Step 014](/work-items/step-014-all-files/requirements)). Code blocks are highlighted before the sanitizer runs, so its output is sanitized like the rest; the sanitizer keeps only highlight.js's class names (`hljs`, `hljs-*` and modifiers such as `class_`) on `code` and `span`, which raw HTML in a spec can use only to color text. A text file other than Markdown is shown as the text of one code element, built from the file directly: it is never parsed as Markdown or HTML.
- Comments ([Step 012](/work-items/step-012-comment-threads/requirements)) use the chat answers' restricted pipeline: raw HTML is never parsed, and no link or image is rendered, only their text and URL. The comment editor turns links and images into text. The names recorded with comments come from Git and are labels, not identities: anyone can edit any comment.
- Links to other `.md` files open them in Specquer; other links open in a new tab with `rel="noopener noreferrer"`.

<a id="SPEC-00070" data-uid="cj8b93fcfnht"></a>
## 7. Content-Security-Policy

The page is sent with:

```
default-src 'self'; script-src 'self' <hashes>; style-src 'self' 'unsafe-inline';
img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' <dev WebSocket>;
worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'
```

- `script-src` allows only the server's own scripts plus SHA-256 hashes of the page's inline scripts (in development, Bun's dev server adds one), computed from the page as served.
- `style-src` allows inline styles, which CodeMirror, Milkdown and the palette inject.
- `img-src` allows remote `https:` images, which specs commonly use. This lets a spec's author learn when it is previewed; it doesn't expose any data. `data:` is allowed because the favicon and the app icon are `data:` URIs.
- In development, `connect-src` also allows the hot-reload WebSocket.
- The page also gets `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
- **Images** from `GET /api/image` ([Step 014](/work-items/step-014-all-files/requirements)) are allowed by `img-src 'self'`. Each response has `Content-Type` from the file's extension, never sniffed, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` and its own `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, so an SVG opened directly at its URL can't run scripts in Specquer's origin. The page shows SVG only in `<img>`, never inline. Images get `Cache-Control: no-cache` with an `ETag`, so the browser revalidates; every other API response keeps `no-store`.

<a id="SPEC-00071" data-uid="y8jklshrw984"></a>
## 8. Protecting the User's Work

- **Saves check the version.** The client sends the content hash of the version its edits are based on. If the file changed on disk since (a coding agent, another editor or another tab), the server answers `409` and doesn't write; the user chooses between reloading from disk and keeping their version.
- **Atomic writes.** Files, `uistate.yaml`, the section data files and the configuration files are written to a temporary file in the same folder and renamed over the original, so a crash never leaves a half-written file.
- **Section anchors change files only when the user does.** Viewing a file and the background scan never write. Anchors are added when a sectioned file is saved or created, and by **Add section anchors** (reached through a folder's **Settings…**), which lists the files it will change and asks first. Making a folder unsectioned in its settings leaves its anchors in place. Only files the configuration names are sectioned. A duplicate ID across documents is renumbered only when the user asks, and a file with merge conflict markers is never anchored. `AGENTS.md` is written only when the user ticks the box in **Add section anchors**, and only appended to, once.
- **Settings check the version too.** The settings dialogs send the version of the configuration file they read; a file changed on disk since (a pull, an edit by hand) answers `409` and the dialog reloads instead of overwriting it. A configuration file that isn't valid YAML is never rewritten.
- **Delete preview.** Before deleting, the dialog lists every file that will be deleted, including files the tree doesn't show, and names the files not committed to Git (new, modified or ignored). Outside a Git repository it warns that nothing can be recovered.
- **One Specquer per root folder.** An operating-system lock on `.specquer/user/instance.lock` keeps a second Specquer off a root folder that one already serves, so two processes never allocate section IDs or write the data files side by side (Server Requirements §2). File locks are unreliable on some network file systems, where this protection may not hold.
- **Per-user state stays out of Git.** `.specquer/user/` gets a `.gitignore` containing `*` whenever Specquer writes there and it has none, so a folder that lost it doesn't let `git add -A` commit the session URL in `instance.json` or the chat history.

<a id="SPEC-00072" data-uid="ipvsb7onaku1"></a>
## 9. Summaries and the Model Provider

Summaries (Step 004, Step 005), the model test (Step 006) and the chat (Step 010) are the server's only outbound network calls.

- **Opt-in.** Until a model is configured in `.specquer/shared/agent.config.yaml` (or the personal `.specquer/user/agent.config.yaml`) and its key is set, no request leaves the machine: the slider is disabled and `POST /api/summaries` answers `503`. Specquer then works fully offline.
- **What is sent.** The provider receives the text of each section summarized, the document's path and the titles of the headings above the section. Only saved text is sent, never unsaved edits. For the slider, the text comes from the authenticated client: `POST /api/summaries` takes it in its request (with the session token, Host and Origin checks of every API route) and doesn't read files.
- **Pre-filling.** With `summaries.prefill: true` (off by default), the server itself reads every Markdown file the tree shows and sends every section the slider can summarize to the provider, whether or not anyone opens it, again after each change to a file. Switch it on only for specs you would send anyway. The settings dialog warns when it is switched on, and switching it on in the shared file, which applies to everyone who pulls the change, needs a second confirmation.
- **Shared settings need the user's approval.** The shared file is committed, so a pull can change it, and it decides where the key goes and which environment variable is sent as the key. A shared model whose endpoint (`baseUrl` with `apiKeyEnv`) isn't the default one (NVIDIA's URL with `NVIDIA_API_KEY`) is used only once this user approves that endpoint, and a shared `summaries.prefill: true` takes effect only once approved too. Until then nothing is sent: summaries and the chat say the model waits for approval, and the settings dialog names the URL and the variable, with **Approve this model** and **Approve pre-filling**. Saving the shared settings in the dialog approves what is saved. Approvals are per user, in `.specquer/user/approvals.yaml`. The personal file's settings are the user's own and need none. A `baseUrl` must be `https`, or `http` to this machine only (a local model), so a key never crosses the network in clear text.
- **The model test.** **Test** in the settings dialog makes one call with the model settings as entered, saved or not: a fixed prompt holding nothing from the specs, sent with the key named by `apiKeyEnv` to the base URL entered, as saving that configuration would. Only `https` URLs, and `http` ones to this machine, pass the schema, and the dialog names the URL the key will be sent to.
- **The lookup.** `GET /api/summaries/sections/:id` reads the section's file inside the root folder through the same confined file service as every other route, and answers from the cache only: it never calls the model, so it sends nothing anywhere and works with summaries disabled.
- **Keys.** The configuration never holds an API key, since the shared file is committed. It names the environment variable that holds the key (`apiKeyEnv: NVIDIA_API_KEY`); the server reads it from its own environment. The settings dialog never asks for, shows or stores a key: it edits the variable's name, and `GET /api/settings/env` answers only whether a variable is set, never its value. The model test's messages never repeat the key. Bun also loads a `.env` file from the server's working directory, which the root `.gitignore` excludes.
- **Free tiers.** The first supported provider is NVIDIA's API catalog (build.nvidia.com), a trial service for evaluation and prototyping under the NVIDIA API Trial Terms of Service, with each model under its own license. As of October 2026 its rate limit is about 40 requests a minute per account, varying by model and load, and production use isn't allowed. Read the current terms, including what they say about storing the text sent, before sending specs that aren't public.
- **Untrusted output.** A spec can contain text that steers the model, so a summary may hold Markdown, links or HTML. The server strips Markdown markers and HTML tags, and the client renders summaries as plain text paragraphs, never as HTML. Each summary is labeled "AI summary" with the model's name and is one click from the full text. Summaries found by the lookup are plain text too.
- **Files other than Markdown** ([Step 014](/work-items/step-014-all-files/requirements)) are never summarized, indexed for the chat or sent to the provider; they are shown only in the browser.
- **The chat.** A question sends the provider the question, the earlier turns (within the configured limits) and the retrieved sections (their text, path, headings and section ID), never unsaved edits: sending a question saves the open file first. The search index is built locally (SQLite FTS5) and sends nothing; only files the tree shows are indexed. Without a model and its key the chat answers `503` and sends nothing.
- **Chat answers are untrusted output.** In the prompt each source is wrapped in a `<source>` tag with `&`, `<` and `>` escaped (and quotes in attributes), so a spec can't close its tag and speak outside it, and the model is told the sources are material, not instructions. The answer is rendered as limited Markdown through its own pipeline, without `rehype-raw`: raw HTML, images and links the model writes are shown as text, and the only links are `[n]` citations whose number the server listed for that answer, pointing at files the tree shows. Answers are rendered with React, never `innerHTML`, and labeled "AI response" with the model's name.
- **The chat history** (`.specquer/user/chat-history.yaml`) holds the questions and answers, so excerpts of the specs; it is per user and ignored by Git. The search index (`.specquer/cache/search.db`) holds the specs' text; `.specquer/cache/` is ignored by Git too.
- **The cache.** Summaries are stored in `.specquer/cache/summaries.db` (SQLite), in the root folder, until unused for 60 days. `.specquer/cache/` gets a `.gitignore` containing `*` whenever Specquer opens a cache there and it has none, so summaries and the search index aren't committed or shared. The browser never calls a model, so the Content-Security-Policy (§7) doesn't change.
