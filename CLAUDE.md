# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

`specquer` is early scaffolding. The target architecture is in `documentation/specifications/technical-architecture.md`. There is no test suite or lint config yet — update this file as structure emerges.

The root is a Bun workspace with five packages (`server`, `agent` and `client` have placeholder entry points; `shared` has no source yet):

- `server/` (`@specquer/server`): the Hono back end
- `agent/` (`@specquer/agent`): the AI functionality, built on LangChain.js (`langchain` with `@langchain/core`; `@langchain/langgraph` comes with `langchain`). Server-side only: `server` depends on it and it depends on `shared` (`server --> agent --> shared`, and `server --> shared` directly). It uses Zod for the shared domain models and for LangChain tool input and structured-output schemas. `client` must never depend on it. See "LangChain rules" below before writing agent code
- `client/` (`@specquer/client`): the React front end, with no build tooling of its own: `server` imports its `index.html` (exported as `@specquer/client/index.html`) and Bun bundles it; uses Zod (usually schemas from `shared`) for client-side input validation
- `shared/` (`@specquer/shared`): the Hono router (route definitions shared by client and server), with request validation via `@hono/zod-validator`, and Zod schemas. `server`, `agent` and `client` all depend on it; `client` depends on neither `server` nor `agent`.
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
- Dev ports are fixed: 3000 server (API and client), 5174 docs. The VitePress server uses `strictPort`, so like the Bun server it fails to start if its port is taken rather than moving to another.
- Dev: `bun run dev` at the root starts one process, `server/src/index.ts` on port 3000 under `bun --hot`. `Bun.serve()` serves the client from its HTML import (bundled on each request, with hot module replacement and React Fast Refresh) and passes every other request to Hono. Keep API routes under `/api` so they never collide with client routes.
- Release build: `bun run build` at the root runs `bun build --compile --production` in `server` and writes the single executable `server/dist/specquer`, with the client bundled and embedded.
- Docs: `bun run --filter @specquer/documentation docs:dev` (http://localhost:5174/specquer/, VitePress run under Bun via `bun --bun`) (also `docs:build`, `docs:preview`), or `bun run docs:dev` inside `documentation/`
- Type-check: `bun run typecheck`. This runs two passes: the root `tsconfig.json`, which excludes `client`, and `client/tsconfig.json`, which uses React's automatic JSX runtime (`jsx: react-jsx`) plus DOM types. TypeScript 7; the root config is strict with `noUncheckedIndexedAccess`, `verbatimModuleSyntax` — use `import type` for type-only imports.
- Test: `bun test`; a single file: `bun test path/to/file.test.ts`; a single test by name: `bun test -t "name pattern"`

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

Use `bun test` to run tests.

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
- Release: `bun build --compile --production` bundles the client from the HTML import and embeds it in the executable; `--production` also sets `NODE_ENV=production`, which turns `development` off.

See `documentation/specifications/technical-architecture.md`.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
