<a id="SPEC-00084" data-uid="crzxf49hslqn"></a>

<a id="SPEC-00085" data-uid="ltoun5582va0"></a>
# Specquer Technical Architecture

This document records the technology choices for Specquer and the rules that follow from them. For a summary of the system, see the [Architecture Overview](overview.md).

<a id="SPEC-00086" data-uid="r1510k1tdffs"></a>
## 1. Principles

1. **One language.** All code is TypeScript.
2. **One runtime.** Bun is the runtime, package manager, test runner and script runner for every package. Third-party tools built for Node (VitePress) are run under Bun with `bun --bun`.
3. **One contract.** The client and the server share a single route definition and a single set of schemas. Neither is the source of truth for the other; both depend on the shared package.
4. **One deliverable.** Specquer ships as a single executable that contains the server and the client.

<a id="SPEC-00087" data-uid="z2h2dy7murwi"></a>
## 2. Platform

| Aspect | Decision |
| ------ | -------- |
| Language | TypeScript 7 |
| Runtime | Bun, version pinned in `mise.toml` |
| Package management | Bun workspaces, one lockfile (`bun.lock`) at the repository root |
| Type checking | Strict mode, including `noUncheckedIndexedAccess` and `verbatimModuleSyntax` |
| Testing | `bun test` for unit and component tests; Playwright for end-to-end tests (§11) |

<a id="SPEC-00088" data-uid="pqyx6ltyz5l3"></a>
## 3. Repository Structure

The repository is a Bun workspace with five packages.

| Folder | Package | Purpose |
| ------ | ------- | ------- |
| `./shared` | `@specquer/shared` | API contract (routes, request validation, schemas), workspace paths, section IDs, the Markdown domain (including the heading outline), the summary rules and the UI-state domain |
| `./server` | `@specquer/server` | Back end: implements the API and serves the client |
| `./agent` | `@specquer/agent` | AI functionality, used by the back end: the agent configuration, the chat model, summarization |
| `./client` | `@specquer/client` | Front end: browser user interface |
| `./documentation` | `@specquer/documentation` | Documentation site, including these specifications |

<a id="SPEC-00089" data-uid="use8kv701n8t"></a>
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

<a id="SPEC-00090" data-uid="fp6n58m1lmra"></a>
### 3.2 Dependency Rules

- **Isolated installs.** Bun installs this workspace in isolated mode, so each package can load only the dependencies it declares itself. Any package a package imports, directly or through a tool that expects it next to itself, must be declared in that package's own `package.json`.
- **Single versions.** `hono` and `zod` must resolve to exactly one version across the workspace. The client's type safety depends on the client, server and shared packages all using the same Hono and Zod types, and the agent's tools and domain models depend on the agent using the same Zod types as the shared package. LangChain.js (`langchain`, `@langchain/core`) declares `zod` as an ordinary dependency with a range (`^3.25.76 || ^4`) that the workspace version satisfies, so it shares the agent's copy; after changing LangChain or Zod versions, check that `bun.lock` still contains a single `zod` version.
- **React in the server.** Bun applies React Fast Refresh to the client only when `react` can be resolved from the server package, so `server` declares `react` as a development dependency, on the same version as `client`.
- **Tailwind in the server.** The Tailwind bundler plugin runs in the server package (from `server/bunfig.toml` and `server/build.ts`), so `server` declares `bun-plugin-tailwind` and `tailwindcss` as development dependencies.

<a id="SPEC-00091" data-uid="m6vvr2jiweuy"></a>
## 4. Shared Package

The shared package holds everything both sides need. It must run unchanged in the browser, in a Web Worker and in Bun, so it uses no `Bun.*` or DOM APIs.

| Module | Export | Contents |
| ------ | ------ | -------- |
| API | `@specquer/shared/api` | Hono router (`createApiRouter`) with every route, Zod request schemas, response types |
| Paths | `@specquer/shared/paths` | Workspace path and name validation (relative, `/`-separated, no `..`, no `.git` or `.specquer`) |
| Markdown | `@specquer/shared/markdown` | Front matter split and join, YAML syntax check (`yaml` package), the preview pipeline, finding and adding section anchors; see [Data Architecture](data-architecture.md) §1 and §2 |
| Sections | `@specquer/shared/sections` | Section ID and UID formats; the section anchor rules for coding agents |
| UI state | `@specquer/shared/uistate` | Zod schema, defaults and pure update functions; see [Data Architecture](data-architecture.md) §3 |

| Aspect | Decision |
| ------ | -------- |
| Routing | Hono router, defining every client–server route; the server supplies the handlers |
| Request validation | Zod schemas attached to routes with `@hono/zod-validator` |
| Schemas | Zod |
| API path prefix | All API routes are under `/api` |
| YAML in shared code | The `yaml` package (`Bun.YAML` exists only on the server) |

The router's type is what the client's typed Hono client uses, so the client gets compile-time checking of paths, parameters, request bodies and responses without importing any server code.

<a id="SPEC-00092" data-uid="vebs3f9h3h75"></a>
## 5. Back End

| Aspect | Decision |
| ------ | -------- |
| Folder | `./server` |
| HTTP server | `Bun.serve()`, listening on `127.0.0.1` only |
| Framework | Hono, running on Bun, for every request except the bundled client assets |
| API | Mounts the router from `shared`, with handlers for the file-system service and the UI-state store |
| Schemas | Zod, from `shared` |
| UI state | `.specquer/user/uistate.yaml` under the root folder, read and written with `Bun.YAML` |
| Sections | `SectionIndex` (`server/src/sections/`): an in-memory index of the sectioned files and the data files in `.specquer/shared/`, which the `yaml` package reads and writes (it keeps key order and writes one flow mapping per line); document IDs and section UIDs are 12-character CUID2s (`@paralleldrive/cuid2`'s `init({ length: 12 })`) carried in the anchors' `data-uid`; the data files are read again when they change on disk; see [Data Architecture](data-architecture.md) §2 |
| Security | Session token, Host and Origin checks, Content-Security-Policy; see [Security](security.md) |
| AI features | Delegated to `agent`. The summary service (`server/src/summaries/`) reads the agent configuration, keeps summaries in a SQLite cache (`bun:sqlite`, `.specquer/cache/summaries.db`) and queues model calls; see [Data Architecture](data-architecture.md) §4 |
| Outbound network | Only to the configured model provider, and only when summaries are configured; see [Security](security.md) §9 |
| Development port | 3000 |
| Development mode | `bun --hot` (reloads on change) |

<a id="SPEC-00093" data-uid="tfowa3wagi64"></a>
### 5.1 Routing

`Bun.serve()` and Hono share the work:

- `Bun.serve()`'s `routes` serve only the bundled client: the HTML page at an internal path and its scripts and stylesheets. Bun's HTML routes can't add headers, so the page itself is not served from `/`.
- Everything else goes to Hono through `fetch: app.fetch`. Hono's `/` handler checks the session, fetches the page from the internal path, and returns it with the Content-Security-Policy. Hono also serves the preview worker script (§7.3) and the API.

The command line, the file-system rules and the API are specified in [Server Requirements](server-requirements.md).

<a id="SPEC-00094" data-uid="zibabwgaafzu"></a>
## 6. AI Agent

| Aspect | Decision |
| ------ | -------- |
| Folder | `./agent` |
| Purpose | All of Specquer's AI functionality |
| Runs in | The back end process only; it is never bundled into the client |
| AI library | LangChain.js (`langchain`, with `@langchain/core`); LangGraph (`@langchain/langgraph`) comes with it for stateful, multi-step workflows |
| Domain models | Zod schemas from `shared` |
| Tool schemas | Zod, used to define the input of LangChain tools and structured output |
| Model provider | `@langchain/openai`'s `ChatOpenAI`, pointed at NVIDIA's OpenAI-compatible API (`https://integrate.api.nvidia.com/v1`); the model is configured in `.specquer/shared/agent.config.yaml` |
| Used by | `server`, which exposes agent features through API routes |
| Features | Summaries of sections (Step 004): `config.ts` (the configuration schema and merging), `model.ts` (the chat model for a configuration), `summarize.ts` (the prompt, plain-text output, and the fallback for long sections) |

<a id="SPEC-00095" data-uid="bfd2gvoja5mj"></a>
### 6.1 Package Rationale

The AI functionality runs on the server and could live inside `./server`. It is kept in its own package to make its AI-centric role explicit and to keep model, prompt and tool code apart from HTTP handling. The server stays responsible for routes, and the agent package for talking to language models.

<a id="SPEC-00096" data-uid="zfxuu9i64jd6"></a>
### 6.2 LangChain Usage

- The JavaScript implementation is used, in the same Bun process as the server. Python LangChain is not used, so the system keeps one language and one executable.
- Models are reached through LangChain provider packages (such as `@langchain/anthropic`). A provider package is added to `agent` only when a feature needs it.
- LangChain code is written against the installed version, using its type definitions and the JavaScript documentation for that major version, not from memory, because the API changes between major versions. Examples written for Python LangChain are not copied, since the two APIs differ.
- Providers: NVIDIA's hosted models come through `@langchain/openai`, since `initChatModel` has no NVIDIA entry. Other providers will come through `initChatModel("provider:model")` and their packages; `createChatModel` in `agent/src/model.ts` is the only place that changes.
- Tests use a fake model (`FakeListChatModel` from `@langchain/core/utils/testing` in `agent`, a stub in `server`), and the end-to-end tests a fake OpenAI-compatible server (`e2e/fake-model.ts`), so no test calls a real model or needs a key.
- LangSmith tracing is off. `langchain` depends on `langsmith`, which sends traces to LangSmith only when tracing environment variables (such as `LANGSMITH_TRACING`) are set; Specquer does not set them.

<a id="SPEC-00097" data-uid="wjnprm2r7abj"></a>
### 6.3 Summary Request Flow

```
client                         server                          agent / provider
Preview ─ outline of saved text
  │ SummaryStore.need(sections)
  │ POST /api/summaries ───────► SummaryService
  │  (≤ 3 in flight; aborted)     ├─ short? → as written
  │                               ├─ cache (bun:sqlite) hit? → cached
  │                               └─ CallQueue (concurrency, ─► summarizeWithFallback
  │                                  shared calls, drops)         └─ ChatOpenAI ─► NVIDIA
  ◄──────── { summary, model, cached, truncated }
```

The client sends saved text only, and the server never reads files for summaries. The details are in [Data Architecture](data-architecture.md) §4.

<a id="SPEC-00098" data-uid="yk5wgoalz22d"></a>
## 7. Front End

| Aspect | Decision |
| ------ | -------- |
| Folder | `./client` |
| Framework | React |
| Styling | Tailwind CSS (v4), through `bun-plugin-tailwind` |
| Components | shadcn components (Radix UI, `lucide-react` icons) in `client/src/components/ui`, imported with the `@/` alias |
| Colors | One module, `client/src/theme/palette.ts`, derives both modes from the light-mode colors (OKLCH, `culori`) |
| Icons | The favicon and app icon are SVG, generated from one module, `client/src/theme/logo.ts`, in the palette's colors |
| Text editing | CodeMirror 6, with a small wrapper of its own (`@codemirror/lang-markdown`, `@codemirror/lang-yaml`; `@codemirror/autocomplete` for section link completion, `@codemirror/merge`'s `diff` for applying outside changes minimally) |
| WYSIWYG editing | Milkdown (`@milkdown/kit`, CommonMark and GFM presets), with a node view that shows section anchors as badges |
| Markdown preview | The `shared` pipeline (unified, remark-parse, remark-gfm, remark-frontmatter, remark-rehype, rehype-raw, rehype-sanitize), run in a Web Worker and rendered with `hast-util-to-jsx-runtime` |
| Summaries | The summary slider (the shadcn Slider on Radix UI) above the preview; the rendered tree filtered by stop (`summarizeTree` from `shared`), with summaries from `SummaryStore` (`client/src/app/summaries.ts`) rendered as plain text |
| API client | Hono typed client (`hc`), typed from the router in `shared` |
| Input validation | Zod and the validation functions from `shared`, so the client and server apply the same rules |
| Build tool | Bun's bundler, through an HTML import of `client/index.html` in the back end |
| Build output | None of its own; the release build embeds the bundled client in the executable |
| Development server | The back end (`Bun.serve()`), port 3000, with hot module replacement and React Fast Refresh |
| API during development | Same process and origin as the client; no proxy |

The user interface is specified in [Client Requirements](client-requirements.md) and [Information Architecture](info-architecture.md).

<a id="SPEC-00099" data-uid="g17okl13l8fx"></a>
### 7.1 Build Tool Rationale

Bun's bundler compiles React JSX and TypeScript itself, so the client needs no separate build tool. The back end imports `client/index.html` and passes it to `Bun.serve()` as a route. During development Bun bundles the client on each request, with hot module replacement and React Fast Refresh. For a release, `server/build.ts` bundles the client from the same import and embeds it in the executable, which satisfies the single-deliverable principle. Requests that do not match a client route go to Hono.

The trade-off is a smaller plugin ecosystem than Vite's. Bun's frontend plugins are configured in `bunfig.toml` (`server/bunfig.toml` loads the Tailwind plugin for the development server), and the `bun build` CLI does not support them, which is why the release build is a script calling `Bun.build()` (§10).

<a id="SPEC-00100" data-uid="pf7cawuy1vf3"></a>
### 7.2 Type Checking

The client has its own `client/tsconfig.json`, which extends the root configuration and changes these settings:

- `jsx: "react-jsx"` (React's automatic JSX runtime); TypeScript only type-checks the JSX and Bun's bundler compiles it
- DOM libraries in place of Bun types
- The `@/*` path alias for `client/src/*`, which Bun's bundler also reads

The root configuration excludes `./client`, so type checking runs in three passes: the root configuration, `client/tsconfig.json`, and `client/tsconfig.test.json` for the client's tests (the client's settings plus Bun's types).

<a id="SPEC-00101" data-uid="w5s8irdj8t83"></a>
### 7.3 Preview Worker

Parsing Markdown is most of the cost of a preview render (about 80 ms of 100 ms for a 2,400-line spec), so the preview parses in a Web Worker and the main thread only turns the resulting HTML syntax tree into React elements. Bun's HTML bundling does not bundle workers, so the server builds the worker (`client/src/preview/preview-worker.ts`) with `Bun.build()` and serves it at `/_specquer/preview-worker.js`. The worker build uses the `worker` export condition, because some dependencies' browser builds use the DOM, which workers lack. The release build embeds the worker script. If the worker can't start, the preview parses on the main thread.

<a id="SPEC-00102" data-uid="r2ww926dia8b"></a>
## 8. Documentation

| Aspect | Decision |
| ------ | -------- |
| Folder | `./documentation` |
| Framework | VitePress, run under Bun |
| Specifications | `./documentation/specifications` |
| Development port | 5174 |
| Favicon | `documentation/public/favicon.svg`, a gray variant of the app's favicon generated from `client/src/theme/logo.ts`, linked in the VitePress `head` config with the `/specquer/` base written out |
| Direct dependencies | `vitepress` and `vue` (`vue` is required because installs are isolated; see §3.2) |

<a id="SPEC-00103" data-uid="tvut2sk3km3q"></a>
## 9. Development Environment

<a id="SPEC-00104" data-uid="qa1sysrpbpls"></a>
### 9.1 Ports

Each development server has a fixed port. A server whose port is taken fails to start instead of moving to another port (VitePress uses `strictPort`; `Bun.serve()` fails when its port is taken).

| Port | Service |
| ---- | ------- |
| 3000 | Back end (Hono) and client |
| 5174 | Documentation development server (VitePress) |

<a id="SPEC-00105" data-uid="x790ro079hkc"></a>
### 9.2 Development Workflow

A single root command (`bun run dev`) starts the back end under `bun --hot`, with the repository itself as the root folder. It serves both the API and the client on port 3000, so during development, as in production, the client and the API come from the same process and address.

<a id="SPEC-00106" data-uid="tuv5mm8u8vpt"></a>
## 10. Deployment

| Aspect | Decision |
| ------ | -------- |
| Packaging | Single self-contained executable, built by `server/build.ts` with `Bun.build({ compile })` |
| Client assets | Bundled by Bun from the back end's HTML import (with the Tailwind plugin), embedded in the executable, served by `Bun.serve()` |
| Preview worker | Built first and embedded in the executable as a constant |
| Runtime processes | One process serving both the API and the client on a single port |
| Port | Tries 4870, falls back to a free port; `--port` fixes it |
| Summary cache | `bun:sqlite` is built into Bun, so the compiled executable creates and reads `.specquer/cache/summaries.db` with nothing extra to ship (checked in Step 004) |

In production the back end serves the client from assets embedded in the executable, not from files on disk. `bun run build` runs `server/build.ts`: it builds the preview worker, then calls `Bun.build()` with `compile`, the Tailwind plugin and `NODE_ENV` defined as `production`, which turns off development mode in `Bun.serve()`. The output is `server/dist/specquer`.

<a id="SPEC-00107" data-uid="g783j2n244hf"></a>
## 11. Testing

| Layer | Tool | Location | Command |
| ----- | ---- | -------- | ------- |
| Unit | `bun test` | `*.test.ts` next to the code in every package | `bun test` |
| Component | `bun test`, happy-dom, React Testing Library | `client/src/**/*.test.tsx` | `bun test` |
| End-to-end | Playwright's test runner on the Bun runtime, Chrome and WebKit | `e2e/` | `bun run test:e2e` |

- The root `bunfig.toml` preloads happy-dom for all tests, then puts back Bun's own `fetch`, `Request`, `Response` and timers, which the server tests use. It also keeps `e2e/` out of `bun test`, since `bun test` would otherwise pick up Playwright's `*.spec.ts` files.
- `test:e2e` runs `bun --bun x playwright test`. Without `--bun`, Playwright silently runs on Node when Node is installed. Running Playwright on Bun isn't officially supported; the fallback is the `playwright` library inside `bun test`.
- Tests never call a real model: `agent` uses LangChain's `FakeListChatModel`, the server tests a stub model, and `e2e/summaries.spec.ts` a fake OpenAI-compatible server (`e2e/fake-model.ts`) that `agent.config.yaml` points at. The Specquer started for end-to-end tests gets a test key in `SPECQUER_E2E_MODEL_KEY`.
- Each end-to-end test starts its own Specquer, in production mode, on a temporary Git repository. Chrome is the installed browser (`channel: "chrome"`); WebKit, the engine of a future desktop shell on macOS and Linux, needs `bunx playwright install webkit` once.
