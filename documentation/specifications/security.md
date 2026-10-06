# Specquer Security

Specquer is a local web server that can read, write, rename and delete files under its root folder. Anything that can talk to it can do the same, so the server is protected against other websites in the user's browser, other machines on the network and malicious content in the Markdown files themselves.

The rules below are implemented in `server/src/security.ts`, `server/src/files.ts` and the shared preview pipeline, and are covered by unit tests (`server/src/security.test.ts`, `server/src/files.test.ts`, `shared/src/markdown/preview.test.ts`) and end-to-end tests (`e2e/launch.spec.ts`, `e2e/views.spec.ts`).

## 1. Threats

| Threat | Example | Protection |
| ------ | ------- | ---------- |
| Network access | Another machine on the same network calls the API | Listen on loopback only (§2) |
| Cross-site requests | A website the user visits sends `fetch("http://127.0.0.1:4870/api/...")` | Session token (§3), Origin check (§4) |
| DNS rebinding | A website makes its own host name resolve to `127.0.0.1` and reads the API as same-origin | Host check (§4) |
| Path traversal | `GET /api/file?path=../../.ssh/id_rsa.md`, or a symbolic link out of the root | Path confinement (§5) |
| Cross-site scripting through Markdown | A spec contains `<img src=x onerror="fetch('/api/entry?path=docs', {method: 'DELETE'})">` | Sanitizing (§6), Content-Security-Policy (§7) |
| Lost work | Autosave overwrites a file a coding agent just changed; deleting a folder removes files the tree doesn't show | Version check on save; delete preview (§8) |

## 2. Network

- The server listens on `127.0.0.1` only, never on all interfaces.
- The launch URL uses `http://127.0.0.1:<port>/`, which avoids `localhost` resolving to IPv6 first.
- The server sets `reusePort: false`, so a second Specquer can't bind the same port and share its connections; it falls back to a free port instead.

## 3. Session Token

- At startup the server generates a token: 32 random bytes, base64url-encoded. Under `bun --hot` it is kept for the life of the process.
- The launch URL carries it: `/?token=<token>`. A request with a valid token gets a cookie and a `303` redirect to `/`, which drops the token from the address bar and history.
- The cookie is `HttpOnly` and `SameSite=Strict`. Its name includes the port (`specquer_session_<port>`), because cookies are shared between ports on the same host and several Specquers may run at once.
- Every `/api` request needs the cookie, or an `Authorization: Bearer <token>` header for non-browser clients (a future desktop shell or coding agent). Without either the API answers `401`.
- The page at `/` also needs the cookie; without it the server answers `401` with a short explanation.
- Tokens are compared in constant time.
- **Known exposure:** opening the browser passes the launch URL, token included, to the operating system's opener (`xdg-open`, `open`, `start`), so it is briefly visible in the process list to other local users. This is acceptable for a single-user workstation tool. `--no-open` avoids it.

## 4. Host and Origin Checks

- **Host:** every request handled by Hono must have a `Host` header of `127.0.0.1:<port>` or `localhost:<port>`; anything else gets `403`. This defeats DNS rebinding, where the browser would send the attacker's host name.
- **Origin:** every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) must have an `Origin` of `http://127.0.0.1:<port>` or `http://localhost:<port>`. A request authenticated with a bearer token may omit `Origin`; one authenticated by cookie may not.
- API responses carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- **Limitation:** the bundled client's scripts and stylesheets are served by `Bun.serve()`'s routes, which bypass Hono, so the Host check doesn't cover them. They contain only the public client code, never user data.

## 5. Path Confinement

- Every path the API receives is validated by the shared path rules: relative to the root, `/`-separated, no `..`, no absolute or drive paths, no backslashes or control characters, and no `.git` or `.specquer` segment.
- The server resolves the path against the root and checks the **real** path (after following symbolic links) stays inside the root. For rename and delete, which act on the entry itself, the real path of its folder must be inside the root, so a symbolic link is renamed or deleted, never its target.
- Reading and writing are limited to existing `.md` files that are UTF-8 text. The API can't create files.
- Rename changes only the name within the same folder; the new name is validated the same way and a file must keep its extension.
- The root folder itself can't be renamed or deleted.

## 6. Rendering Untrusted Markdown

Spec files may contain raw HTML (traceability anchors such as `<a name="r7k2" data-status="draft"></a>`). Since the page can write files, script in a spec would be able to write files too.

- The preview pipeline parses raw HTML with `rehype-raw` and then sanitizes it with `rehype-sanitize`, using GitHub's list of allowed tags and attributes plus `data-*` attributes on `a` and `span`. Scripts, event handlers, `iframe`, `object`, `style` and `javascript:` URLs are removed.
- The sanitizer prefixes `id` and `name` values with `user-content-` against DOM clobbering, as GitHub does; in-page links (`#id`) are rewritten to match.
- The preview is rendered to React elements, never with `innerHTML`.
- Milkdown (the WYSIWYG view) shows raw HTML as text and doesn't render it.
- Links to other `.md` files open them in Specquer; other links open in a new tab with `rel="noopener noreferrer"`.

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
- `img-src` allows remote `https:` images, which specs commonly use. This lets a spec's author learn when it is previewed; it doesn't expose any data.
- In development, `connect-src` also allows the hot-reload WebSocket.
- The page also gets `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

## 8. Protecting the User's Work

- **Saves check the version.** The client sends the content hash of the version its edits are based on. If the file changed on disk since (a coding agent, another editor or another tab), the server answers `409` and doesn't write; the user chooses between reloading from disk and keeping their version.
- **Atomic writes.** Files and `uistate.yaml` are written to a temporary file in the same folder and renamed over the original, so a crash never leaves a half-written file.
- **Delete preview.** Before deleting, the dialog lists every file that will be deleted, including files the tree doesn't show, and names the files not committed to Git (new, modified or ignored). Outside a Git repository it warns that nothing can be recovered.
- **Per-user state stays out of Git.** `.specquer/user/` gets a `.gitignore` containing `*` when Specquer creates it.
