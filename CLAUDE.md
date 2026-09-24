# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

`specquer` is early scaffolding. The target architecture is in `documentation/specifications/architecture/technical-architecture.md`. There is no test suite or lint config yet — update this file as structure emerges.

The root is a Bun workspace with four packages (`server` and `client` have placeholder entry points; `shared` has no source yet):

- `server/` (`@specquer/server`): the Hono back end
- `client/` (`@specquer/client`): the SolidJS front end; uses Zod (usually schemas from `shared`) for client-side input validation
- `shared/` (`@specquer/shared`): the Hono router (route definitions shared by client and server), with request validation via `@hono/zod-validator`, and Zod schemas. `server` and `client` both depend on it; neither depends on the other.
- `documentation/` (`@specquer/documentation`): the VitePress docs site; specs live under `documentation/specifications/`. Bun installs workspaces in isolated mode, so packages only see their direct dependencies. `vue` is therefore a direct dev dependency here; without it, `docs:build` fails under Bun with "Cannot find package '@vue/server-renderer'".

## CI

`.github/workflows/docs.yml` builds the docs site and deploys it to GitHub Pages (https://martin-nordberg.github.io/specquer/) on pushes to `main` that touch `documentation/`, the root `package.json`, `bun.lock` or `mise.toml`. It can also be run by hand. Bun comes from `mise.toml` via `jdx/mise-action`. Because of Pages, VitePress has `base: "/specquer/"`, so site-internal links must be root-relative (`/specifications/...`); VitePress adds the prefix.

## Commands

- Install: `bun install` at the root installs all workspaces (Bun version pinned to 1.4.2 via `mise.toml`); add a dependency to one package with `bun add <pkg> --filter @specquer/server`, and link workspaces with `"@specquer/shared": "workspace:*"`. Keep `hono` and `zod` on the same version in every package so the lockfile resolves one copy of each; the shared router and schema types rely on that
- Dev ports are fixed: 3000 Hono, 5173 client, 5174 docs. The Vite and VitePress servers use `strictPort`, so like the Hono server they fail to start if their port is taken rather than moving to another.
- Dev: `bun run dev` at the root starts the Hono server (`server/src/index.ts`, port 3000, `bun --hot`) and the Vite dev server (port 5173, run under the Bun runtime with `bun --bun vite`). Vite forwards `/api/*` to port 3000, so API routes must live under `/api`.
- Client build: `bun run --filter @specquer/client build` writes `client/dist`
- Docs: `bun run --filter @specquer/documentation docs:dev` (http://localhost:5174/specquer/, VitePress run under Bun via `bun --bun`) (also `docs:build`, `docs:preview`), or `bun run docs:dev` inside `documentation/`
- Type-check: `bun run typecheck`. This runs two passes: the root `tsconfig.json`, which excludes `client`, and `client/tsconfig.json`, which uses Solid JSX (`jsx: preserve`, `jsxImportSource: solid-js`) plus DOM and Vite types. TypeScript 7; the root config is strict with `noUncheckedIndexedAccess`, `verbatimModuleSyntax` — use `import type` for type-only imports.
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

See `documentation/specifications/architecture/technical-architecture.md`.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
