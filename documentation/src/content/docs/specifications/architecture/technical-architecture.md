---
title: Specquer Technical Architecture
---

This document records the technology choices for Specquer and the rules that follow from them. For a summary of the system, see the [Architecture Overview](/specquer/specifications/architecture/overview/).

## 1. Principles

1. **One language.** All code is TypeScript.
2. **One runtime.** Bun is the runtime, package manager, test runner and script runner for every package. Third-party tools built for Node (Astro) are run under Bun with `bun --bun`.
3. **One contract.** The client and the server share a single route definition and a single set of schemas. Neither is the source of truth for the other; both depend on the shared package.
4. **One deliverable.** Specquer ships as a single executable that contains the server and the client.

## 2. Platform

| Aspect | Decision |
| ------ | -------- |
| Language | TypeScript 7 |
| Runtime | Bun, version pinned in `mise.toml` |
| Package management | Bun workspaces, one lockfile (`bun.lock`) at the repository root |
| Type checking | Strict mode, including `noUncheckedIndexedAccess` and `verbatimModuleSyntax` |
| Testing | `bun test` |

## 3. Repository Structure

The repository is a Bun workspace with five packages.

| Folder | Package | Purpose |
| ------ | ------- | ------- |
| `./shared` | `@specquer/shared` | API contract: routes, request validation and schemas |
| `./server` | `@specquer/server` | Back end: implements the API and serves the client |
| `./agent` | `@specquer/agent` | AI functionality, used by the back end |
| `./client` | `@specquer/client` | Front end: browser user interface |
| `./documentation` | `@specquer/documentation` | Documentation site, including these specifications |

### 3.1 Package Dependencies

```
server ─────► agent
  │ │           │
  │ │           ▼
  │ └───────► shared ◄── client
  │                        ▲
  └────────────────────────┘  (HTML entry point only)
```

- `server`, `agent` and `client` each depend on `shared` (`"@specquer/shared": "workspace:*"`).
- `server` depends on `agent` (`"@specquer/agent": "workspace:*"`) as well as on `shared` directly.
- `agent` is server-side only. `client` never depends on `agent`, and `agent` never depends on `server`.
- `server` depends on `client` (`"@specquer/client": "workspace:*"`) only to import its HTML entry point, `@specquer/client/index.html`, which Bun bundles into the served client. `server` never imports client code, and `client` never depends on `server`.
- `shared` depends on no other workspace package.
- `documentation` is independent of the application packages.

### 3.2 Dependency Rules

- **Isolated installs.** Bun installs this workspace in isolated mode, so each package can load only the dependencies it declares itself. Any package a package imports, directly or through a tool that expects it next to itself, must be declared in that package's `package.json`.
- **Single versions.** `hono` and `zod` must resolve to exactly one version across the workspace. The client's type safety depends on the client, server and shared packages all using the same Hono and Zod types, and the agent's tools and domain models depend on the agent using the same Zod types as the shared package. LangChain.js (`langchain`, `@langchain/core`) declares `zod` as an ordinary dependency with a range (`^3.25.76 || ^4`) that the workspace version satisfies, so it shares the agent's copy; after changing LangChain or Zod versions, check that `bun.lock` still contains a single `zod` version.
- **React in the server.** Bun applies React Fast Refresh to the client only when `react` can be resolved from the server package, so `server` declares `react` as a development dependency, on the same version as `client`.

## 4. Shared Package

| Aspect | Decision |
| ------ | -------- |
| Routing | Hono router, defining every client–server route |
| Request validation | Zod schemas attached to routes with `@hono/zod-validator` |
| Schemas | Zod |
| API path prefix | All API routes are under `/api` |

The router's type is what the client's typed Hono client uses, so the client gets compile-time checking of paths, parameters, request bodies and responses without importing any server code.

## 5. Back End

| Aspect | Decision |
| ------ | -------- |
| Folder | `./server` |
| Framework | Hono, running on Bun (replaces `Bun.serve()` routing) |
| API | Mounts the router from `shared` |
| Schemas | Zod, from `shared` |
| AI features | Delegated to `agent` |
| Static assets | Serves the built client |
| Development port | 3000 |
| Development mode | `bun --hot` (reloads on change) |

## 6. AI Agent

| Aspect | Decision |
| ------ | -------- |
| Folder | `./agent` |
| Purpose | All of Specquer's AI functionality |
| Runs in | The back end process only; it is never bundled into the client |
| AI library | LangChain.js (`langchain`, with `@langchain/core`); LangGraph (`@langchain/langgraph`) comes with it for stateful, multi-step workflows |
| Domain models | Zod schemas from `shared` |
| Tool schemas | Zod, used to define the input of LangChain tools and structured output |
| Used by | `server`, which exposes agent features through API routes |

### 6.1 Package Rationale

The AI functionality runs on the server and could live inside `./server`. It is kept in its own package to make its AI-centric role explicit and to keep model, prompt and tool code apart from HTTP handling. The server stays responsible for routes, and the agent package for talking to language models.

### 6.2 LangChain Usage

- The JavaScript implementation is used, in the same Bun process as the server. Python LangChain is not used, so the system keeps one language and one executable.
- Models are reached through LangChain provider packages (such as `@langchain/anthropic`). A provider package is added to `agent` only when a feature needs it.
- LangChain code is written against the installed version, using its type definitions and the JavaScript documentation for that major version, not from memory, because the API changes between major versions. Examples written for Python LangChain are not copied, since the two APIs differ.
- LangSmith tracing is off. `langchain` depends on `langsmith`, which sends traces to LangSmith only when tracing environment variables (such as `LANGSMITH_TRACING`) are set; Specquer does not set them.

## 7. Front End

| Aspect | Decision |
| ------ | -------- |
| Folder | `./client` |
| Framework | React |
| API client | Hono typed client (`hc`), typed from the router in `shared` |
| Input validation | Zod, using the schemas from `shared`, so the client and server apply the same rules |
| Build tool | Bun's bundler, through an HTML import of `client/index.html` in the back end |
| Build output | None of its own; the release build embeds the bundled client in the executable |
| Development server | The back end (`Bun.serve()`), port 3000, with hot module replacement and React Fast Refresh |
| API during development | Same process and origin as the client; no proxy |

### 7.1 Build Tool Rationale

Bun's bundler compiles React JSX and TypeScript itself, so the client needs no separate build tool. The back end imports `client/index.html` and passes it to `Bun.serve()` as a route. During development Bun bundles the client on each request, with hot module replacement and React Fast Refresh. For a release, `bun build --compile` bundles the client from the same import and embeds it in the executable, which satisfies the single-deliverable principle without extra build steps. Requests that do not match a client route go to Hono.

The trade-off is a smaller plugin ecosystem than Vite's: Bun's frontend plugins are configured in `bunfig.toml`, and the `bun build` CLI does not yet support them.

### 7.2 Type Checking

The client has its own `tsconfig.json`, which extends the root configuration and changes these settings:

- `jsx: "react-jsx"` (React's automatic JSX runtime); TypeScript only type-checks the JSX and Bun's bundler compiles it
- DOM libraries in place of Bun types

The root configuration excludes `./client` and `./documentation`, so type checking runs in three passes: the root configuration, then `client/tsconfig.json`, then the documentation package (`astro sync` to generate its content types, then its own `tsconfig.json`, which extends Astro's strict configuration).

## 8. Documentation

| Aspect | Decision |
| ------ | -------- |
| Folder | `./documentation` |
| Framework | Astro with Starlight, run under Bun |
| Theme | Exquisitus (`starlight-theme-exquisitus`), a Starlight plugin |
| Pages | `./documentation/src/content/docs` |
| Specifications | `./documentation/src/content/docs/specifications` |
| Development port | 5174 |
| Direct dependencies | `astro`, `@astrojs/starlight` and `starlight-theme-exquisitus` |
| Published at | GitHub Pages, under the base path `/specquer` |

## 9. Development Environment

### 9.1 Ports

Each development server has a fixed port. A server whose port is taken fails to start instead of moving to another port (Astro uses `strictPort`; `Bun.serve()` fails when its port is taken).

| Port | Service |
| ---- | ------- |
| 3000 | Back end (Hono) and client |
| 5174 | Documentation development server (Astro) |

### 9.2 Development Workflow

A single root command (`bun run dev`) starts the back end under `bun --hot`. It serves both the API and the client on port 3000, so during development, as in production, the client and the API come from the same process and address.

## 10. Deployment

| Aspect | Decision |
| ------ | -------- |
| Packaging | Single self-contained executable, built with `bun build --compile` |
| Client assets | Bundled by Bun from the back end's HTML import, embedded in the executable, served by `Bun.serve()` |
| Runtime processes | One process serving both the API and the client on a single port |

In production the back end serves the client from assets embedded in the executable, not from files on disk. `bun run build` runs `bun build --compile --production` on the back end; Bun follows the HTML import, bundles and minifies the client, and embeds it. `--production` also sets `NODE_ENV` to `production`, which turns off development mode in `Bun.serve()`.
