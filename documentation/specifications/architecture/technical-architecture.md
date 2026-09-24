# Specquer Technical Architecture

This document records the technology choices for Specquer and the rules that follow from them. For a summary of the system, see the [Architecture Overview](overview.md).

## 1. Principles

1. **One language.** All code is TypeScript.
2. **One runtime.** Bun is the runtime, package manager, test runner and script runner for every package. Third-party tools built for Node (Vite, VitePress) are run under Bun with `bun --bun`.
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

The repository is a Bun workspace with four packages.

| Folder | Package | Purpose |
| ------ | ------- | ------- |
| `./shared` | `@specquer/shared` | API contract: routes, request validation and schemas |
| `./server` | `@specquer/server` | Back end: implements the API and serves the client |
| `./client` | `@specquer/client` | Front end: browser user interface |
| `./documentation` | `@specquer/documentation` | Documentation site, including these specifications |

### 3.1 Package Dependencies

```
server ──► shared ◄── client
```

- `server` and `client` each depend on `shared` (`"@specquer/shared": "workspace:*"`).
- `server` and `client` never depend on each other.
- `shared` depends on no other workspace package.
- `documentation` is independent of the application packages.

### 3.2 Dependency Rules

- **Isolated installs.** Bun installs this workspace in isolated mode, so each package can load only the dependencies it declares itself. Any package a package imports, directly or through a tool that expects it next to itself, must be declared in that package's `package.json`.
- **Single versions.** `hono` and `zod` must resolve to exactly one version across the workspace. The client's type safety depends on the client, server and shared packages all using the same Hono and Zod types.

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
| Static assets | Serves the built client |
| Development port | 3000 |
| Development mode | `bun --hot` (reloads on change) |

## 6. Front End

| Aspect | Decision |
| ------ | -------- |
| Folder | `./client` |
| Framework | SolidJS |
| API client | Hono typed client (`hc`), typed from the router in `shared` |
| Input validation | Zod, using the schemas from `shared`, so the client and server apply the same rules |
| Build tool | Vite with `vite-plugin-solid`, run under Bun |
| Build output | `client/dist` |
| Development server | Vite with hot module replacement, port 5173 |
| API during development | Vite forwards `/api/*` to the back end on port 3000 |

### 6.1 Build Tool Rationale

SolidJS needs its own JSX compiler (`babel-preset-solid`). Bun's bundler compiles JSX React-style and cannot build Solid components on its own. Vite with `vite-plugin-solid` is Solid's supported toolchain and preserves component state across hot reloads. It is therefore the one exception to using Bun's bundler, and it still runs on the Bun runtime.

### 6.2 Type Checking

The client has its own `tsconfig.json`, which extends the root configuration and changes these settings:

- `jsx: "preserve"` and `jsxImportSource: "solid-js"`, so TypeScript only type-checks the JSX and Vite compiles it
- DOM libraries and Vite client types in place of Bun types

The root configuration excludes `./client`, so type checking runs in two passes: the root configuration, then `client/tsconfig.json`.

## 7. Documentation

| Aspect | Decision |
| ------ | -------- |
| Folder | `./documentation` |
| Framework | VitePress, run under Bun |
| Specifications | `./documentation/specifications` |
| Development port | 5174 |
| Direct dependencies | `vitepress` and `vue` (`vue` is required because installs are isolated; see §3.2) |

## 8. Development Environment

### 8.1 Ports

Each development server has a fixed port. A server whose port is taken fails to start instead of moving to another port (Vite and VitePress use `strictPort`).

| Port | Service |
| ---- | ------- |
| 3000 | Back end (Hono) |
| 5173 | Client development server (Vite) |
| 5174 | Documentation development server (VitePress) |

### 8.2 Development Workflow

A single root command starts the back end and the client development server together. The browser loads the client from port 5173. Vite forwards API calls to the back end, so during development the client and the API appear to come from the same address, as they do in production.

## 9. Deployment

| Aspect | Decision |
| ------ | -------- |
| Packaging | Single self-contained executable, built with `bun build --compile` |
| Client assets | Built by Vite, embedded in the executable, served by Hono |
| Runtime processes | One process serving both the API and the client on a single port |

In production the back end must serve the client from files embedded in the executable, not from `client/dist` on disk. The release build therefore compiles the client first, then includes its output when compiling the server.
