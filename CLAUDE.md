# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

`specquer` is early scaffolding. The target architecture is in `documentation/src/content/docs/specifications/architecture/technical-architecture.md`. There is no test suite or lint config yet — update this file as structure emerges.

The root is a Bun workspace with five packages (`server`, `agent` and `client` have placeholder entry points; `shared` has no source yet):

- `server/` (`@specquer/server`): the Hono back end
- `agent/` (`@specquer/agent`): the AI functionality, built on LangChain.js (`langchain` with `@langchain/core`; `@langchain/langgraph` comes with `langchain`). Server-side only: `server` depends on it and it depends on `shared` (`server --> agent --> shared`, and `server --> shared` directly). It uses Zod for the shared domain models and for LangChain tool input and structured-output schemas. `client` must never depend on it. See "LangChain rules" below before writing agent code
- `client/` (`@specquer/client`): the SolidJS front end; uses Zod (usually schemas from `shared`) for client-side input validation
- `shared/` (`@specquer/shared`): the Hono router (route definitions shared by client and server), with request validation via `@hono/zod-validator`, and Zod schemas. `server`, `agent` and `client` all depend on it; `client` depends on neither `server` nor `agent`.
- `documentation/` (`@specquer/documentation`): the Astro Starlight docs site, styled with the Exquisitus theme (`starlight-theme-exquisitus`, a Starlight plugin). Config is `documentation/astro.config.mjs` (sidebar, base, port); pages live under `documentation/src/content/docs/` and specs under its `specifications/`. Every page needs a `title` in its frontmatter, which Starlight renders as the H1, so don't add a `# Heading` too. New pages must be added to the `sidebar` in the config by hand. Bun installs workspaces in isolated mode, so packages only see their direct dependencies.

## LangChain rules

- **JavaScript only.** Use LangChain.js; never add Python. Docs and examples for Python LangChain don't carry over (the APIs differ), so don't copy them.
- **Check the installed API, not memory.** LangChain's API changes between major versions (v1 replaced much of v0.x). Check the type definitions in `agent/node_modules/langchain/` and `agent/node_modules/@langchain/*/`, and the v1 JavaScript docs (https://docs.langchain.com/oss/javascript/).
- **Providers.** Reach models through LangChain provider packages (e.g. `@langchain/anthropic`), added to `agent` only when a feature needs one. Never use model IDs from memory: check the provider package's model ID types, or the provider's own current model list.
- **No LangSmith tracing.** `langsmith` is installed as a dependency of `langchain`, but don't set `LANGSMITH_TRACING` or LangSmith API keys; tracing would send prompts and specs to an external service.

## CI

`.github/workflows/docs.yml` builds the docs site and deploys it to GitHub Pages (https://martin-nordberg.github.io/specquer/) on pushes to `main` that touch `documentation/`, the root `package.json`, `bun.lock` or `mise.toml`. It can also be run by hand. Bun comes from `mise.toml` via `jdx/mise-action`. Because of Pages, Astro has `base: "/specquer"`. Astro does not add that prefix to links in Markdown, so site-internal links must include it and use the page URL, not the file name: `/specquer/specifications/architecture/overview/`. The build writes `documentation/dist`.

## Commands

- Install: `bun install` at the root installs all workspaces (Bun version pinned to 1.4.2 via `mise.toml`); add a dependency to one package with `bun add <pkg> --filter @specquer/server`, and link workspaces with `"@specquer/shared": "workspace:*"`. Keep `hono` and `zod` on the same version in every package (LangChain also depends on `zod`; check that `bun.lock` still has a single `zod` version after upgrading either) so the lockfile resolves one copy of each; the shared router and schema types rely on that
- Dev ports are fixed: 3000 Hono, 5173 client, 5174 docs. The Vite and Astro servers use `strictPort`, so like the Hono server they fail to start if their port is taken rather than moving to another.
- Dev: `bun run dev` at the root starts the Hono server (`server/src/index.ts`, port 3000, `bun --hot`) and the Vite dev server (port 5173, run under the Bun runtime with `bun --bun vite`). Vite forwards `/api/*` to port 3000, so API routes must live under `/api`.
- Client build: `bun run --filter @specquer/client build` writes `client/dist`
- Docs: `bun run --filter @specquer/documentation docs:dev` (http://localhost:5174/specquer/, Astro run under Bun via `bun --bun`) (also `docs:build`, `docs:preview`), or `bun run docs:dev` inside `documentation/`. Run outside an interactive terminal (e.g. by an agent), Astro 7's `astro dev` detaches and keeps running; stop it with `bunx --bun astro dev stop` inside `documentation/`
- Type-check: `bun run typecheck`. This runs three passes: the root `tsconfig.json`, which excludes `client` and `documentation`; `client/tsconfig.json`; and the docs package's `typecheck` script (`astro sync`, which generates the `astro:content` types in `documentation/.astro`, then `tsc` against `documentation/tsconfig.json`, which extends `astro/tsconfigs/strict`). The client config uses Solid JSX (`jsx: preserve`, `jsxImportSource: solid-js`) plus DOM and Vite types. TypeScript 7; the root config is strict with `noUncheckedIndexedAccess`, `verbatimModuleSyntax` — use `import type` for type-only imports.
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

- The server uses Hono (running on Bun), not `Bun.serve()` routes or `express`. The router lives in `shared`; the client calls it through Hono's typed RPC client (`hc`), typed from `shared` rather than from `server`.
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

The client is SolidJS, built with **Vite** (`vite-plugin-solid`). This is the one deliberate exception to "use Bun's bundler": Solid needs its own JSX compiler, which Bun's bundler doesn't provide. Don't write React or use the `Bun.serve()` HTML-import pattern.

- Dev: the Vite dev server serves the client with hot reload and proxies API requests to the Hono server (two processes).
- Build: `vite build` writes `client/dist`, which Hono serves.
- Release: a single executable from `bun build --compile`, with the built client assets embedded and served by Hono.

See `documentation/src/content/docs/specifications/architecture/technical-architecture.md`.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
