# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

`specquer` is a local Markdown spec editor and browser (Step 001: `documentation/work-items/step-001-doc-editing/`; Step 002, sections with permanent IDs: `documentation/work-items/step-002-sections/`). The architecture is in `documentation/specifications/technical-architecture.md`; the other specifications there (security, client and server requirements, information architecture, Markdown and UI-state domain designs) describe the behavior. There is no lint config yet — update this file as structure emerges.

The root is a Bun workspace with five packages (`agent` is still a placeholder):

- `server/` (`@specquer/server`): the Hono back end: command line and launch (`src/index.ts`, `src/cli.ts`), security (`src/security.ts`), the file-system service confined to the root folder (`src/files.ts`), UI state in `.specquer/user/uistate.yaml` (`src/uistate-store.ts`), sections (`src/sections/`: prefix configuration, the data files in `.specquer/shared/` read and written with the `yaml` package, pure reconciliation, and `SectionIndex`, which allocates section IDs and through which saves, creates, renames and deletes go; scans never write)
- `agent/` (`@specquer/agent`): the AI functionality, built on LangChain.js (`langchain` with `@langchain/core`; `@langchain/langgraph` comes with `langchain`). Server-side only: `server` depends on it and it depends on `shared` (`server --> agent --> shared`, and `server --> shared` directly). It uses Zod for the shared domain models and for LangChain tool input and structured-output schemas. `client` must never depend on it. See "LangChain rules" below before writing agent code
- `client/` (`@specquer/client`): the React front end, with no build tooling of its own: `server` imports its `index.html` (exported as `@specquer/client/index.html`) and Bun bundles it; uses Zod (usually schemas from `shared`) for client-side input validation. Tailwind CSS v4, shadcn components hand-copied into `src/components/ui` (imported via the `@/` alias), CodeMirror 6 (own wrapper, `src/components/CodeEditor.tsx`), Milkdown, and all colors in `src/theme/palette.ts`
- `shared/` (`@specquer/shared`): code both sides need, with no Bun or DOM APIs (it also runs in a Web Worker), as subpath exports: `/api` (the Hono router via `createApiRouter(handlers)`, request validation via `@hono/zod-validator`, Zod schemas), `/paths` (workspace path rules), `/markdown` (front matter split/join, the unified/remark/rehype preview pipeline, finding and adding section anchors in `sections.ts`), `/sections` (section ID format), `/uistate` (UI-state schema and pure update functions). Use the `yaml` package here, not `Bun.YAML`. `server`, `agent` and `client` all depend on it; `client` depends on neither `server` nor `agent`.
- `documentation/` (`@specquer/documentation`): the VitePress docs site; specs live under `documentation/specifications/`. Bun installs workspaces in isolated mode, so packages only see their direct dependencies. `vue` is therefore a direct dev dependency here; without it, `docs:build` fails under Bun with "Cannot find package '@vue/server-renderer'".

## LangChain rules

- **JavaScript only.** Use LangChain.js; never add Python. Docs and examples for Python LangChain don't carry over (the APIs differ), so don't copy them.
- **Check the installed API, not memory.** LangChain's API changes between major versions (v1 replaced much of v0.x). Check the type definitions in `agent/node_modules/langchain/` and `agent/node_modules/@langchain/*/`, and the v1 JavaScript docs (https://docs.langchain.com/oss/javascript/).
- **Providers.** Reach models through LangChain provider packages (e.g. `@langchain/anthropic`), added to `agent` only when a feature needs one. Never use model IDs from memory: check the provider package's model ID types, or the provider's own current model list.
- **No LangSmith tracing.** `langsmith` is installed as a dependency of `langchain`, but don't set `LANGSMITH_TRACING` or LangSmith API keys; tracing would send prompts and specs to an external service.

## CI

`.github/workflows/docs.yml` builds the docs site and deploys it to GitHub Pages (https://martin-nordberg.github.io/specquer/) on pushes to `main` that touch `documentation/`, the root `package.json`, `bun.lock` or `mise.toml`. It can also be run by hand. Bun comes from `mise.toml` via `jdx/mise-action`. Because of Pages, VitePress has `base: "/specquer/"`, so site-internal links must be root-relative (`/specifications/...`); VitePress adds the prefix.

## Commands

- Install: `bun install` at the root installs all workspaces (Bun version pinned to 1.4.2 via `mise.toml`); add a dependency to one package with `bun add <pkg> --filter @specquer/server`, and link workspaces with `"@specquer/shared": "workspace:*"`. Keep `hono` and `zod` on the same version in every package (LangChain also depends on `zod`; check that `bun.lock` still has a single `zod` version after upgrading either) so the lockfile resolves one copy of each; the shared router and schema types rely on that
- Dev ports are fixed: 3000 server (API and client), 5174 docs. The VitePress server uses `strictPort`, so like the Bun server it fails to start if its port is taken rather than moving to another. The release executable tries 4870 and falls back to a free port unless `--port` is given.
- Dev: `bun run dev` at the root starts one process, `server/src/index.ts ..` (the repository as the root folder) on port 3000 under `bun --hot`, and opens the browser once. Open the printed URL (it carries the session token; without the cookie it sets, the page and API answer 401). Bun serves the bundled client at an internal path; Hono's `/` handler adds the token check and CSP and passes every other request to Hono. Keep API routes under `/api`.
- Run it: `specquer [root] [--port <n>] [--no-open]` (from source: `bun server/src/index.ts <root> --no-open`, run with `server/` as the working directory so `server/bunfig.toml`'s Tailwind plugin applies).
- Release build: `bun run build` at the root runs `server/build.ts` (`Bun.build()` with `compile` and the Tailwind plugin, since the `bun build` CLI can't load plugins) and writes the single executable `server/dist/specquer`, with the client and the preview worker embedded.
- Docs: `bun run --filter @specquer/documentation docs:dev` (http://localhost:5174/specquer/, VitePress run under Bun via `bun --bun`) (also `docs:build`, `docs:preview`), or `bun run docs:dev` inside `documentation/`
- Type-check: `bun run typecheck`. This runs three passes: the root `tsconfig.json` (excludes `client`), `client/tsconfig.json` (React's automatic JSX runtime, DOM types, `@/*` alias; excludes tests) and `client/tsconfig.test.json` (client plus Bun types, for the client's tests). TypeScript 7; the root config is strict with `noUncheckedIndexedAccess`, `verbatimModuleSyntax` — use `import type` for type-only imports.
- Test: `bun test` at the root (unit and component tests); a single file: `bun test path/to/file.test.ts`; a single test by name: `bun test -t "name pattern"`. Run from the root: the root `bunfig.toml` preloads happy-dom and React Testing Library for the component tests and keeps `e2e/` out.
- End-to-end tests: `bun run test:e2e` (`bun --bun x playwright test`; keep `--bun`, or Playwright silently runs on Node). Specs are in `e2e/`; each test starts its own Specquer in production mode on a temporary Git repository. Chrome uses the installed browser; for one browser: `bun run test:e2e --project=chrome`. WebKit needs `bunx playwright install webkit` (and its system libraries, `sudo bunx playwright install-deps webkit`).

## Bun conventions

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- The server uses Hono (running on Bun) for the API, not `Bun.serve()` routes or `express`. `Bun.serve()`'s `routes` are used only for the client's HTML entry point; everything else goes to Hono through `fetch: app.fetch`. The router lives in `shared`; the client calls it through Hono's typed RPC client (`hc`), typed from `shared` rather than from `server`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests. Three layers (see `documentation/specifications/technical-architecture.md` §11):

- Unit tests (`*.test.ts`) next to the code in every package.
- Component tests (`client/src/**/*.test.tsx`) with happy-dom and React Testing Library. The DOM comes from the root preload (`client/test/register-dom.ts`), which registers happy-dom and then restores Bun's `fetch`, `Request`, `Response` and timers, because `bun test` runs the server tests in the same process. Don't register happy-dom again in a test file.
- End-to-end tests (`e2e/*.spec.ts`) with Playwright; helpers and the per-test server fixture are in `e2e/fixtures.ts`.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

The client is React, bundled by Bun through the `Bun.serve()` HTML-import pattern. There is no Vite in the client (VitePress uses Vite internally for the docs, but that is separate).

- Dev: `server/src/index.ts` imports `@specquer/client/index.html` and passes it to `Bun.serve()`'s `routes`; with `development` on, Bun bundles the client on each request with hot module replacement and React Fast Refresh. One process, one port (3000), no proxy.
- Fast Refresh needs `react` to be resolvable from `server`, so `server` lists `react` as a dev dependency (isolated installs; without it Bun silently skips Fast Refresh and falls back to full reloads). Keep it on the client's `react` version.
- Script and stylesheet paths in `client/index.html` must be relative (`./src/index.tsx`); a root-relative `/src/...` path doesn't resolve.
- Release: `server/build.ts` bundles the client from the HTML import and embeds it in the executable, defining `NODE_ENV=production`, which turns `development` off.
- Tailwind runs as a bundler plugin: `server/bunfig.toml` (`[serve.static] plugins`) for the dev server, `server/build.ts` for the release. Both resolve it from `server`, which therefore lists `bun-plugin-tailwind` and `tailwindcss` as dev dependencies.
- Bun's HTML bundling doesn't bundle Web Workers (`new Worker(new URL(...))` is left as is). The preview worker (`client/src/preview/preview-worker.ts`) is built by the server (`server/src/preview-worker.ts`, with the `worker` export condition) and served at `/_specquer/preview-worker.js`.
- Colors: change them only in `client/src/theme/palette.ts`; its tests check WCAG AA contrast for every text-on-fill pair in both modes.
- `CodeEditor` applies outside changes to `value` (anchors added on save) as minimal edits outside the undo history; extensions passed to it are read once, when it is created, so CodeMirror sources in them must keep their identity.

See `documentation/specifications/technical-architecture.md`.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
