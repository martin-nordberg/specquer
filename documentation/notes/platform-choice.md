# Platform Choice: Bun Server and Browser vs Tauri vs Electrobun

_Notes from October 2026._

**Summary:** keep the current Bun server and browser design for now; it fits Specquer's own specification best. Write the UI so that a desktop shell could wrap it later, and don't adopt Electrobun 2.x yet.

## Electrobun Right Now

- **2.0 is a different product from 1.x.** The author dropped Bun as the foundation after Bun's move from Zig to Rust, and wrote a new JavaScript runtime, **Cottontail** (JavaScriptCore plus Zig, compatible with Node and Bun "where it makes sense"). It is now the default for the main process. Bun is still an option, alongside Zig, Rust, Go and Odin. ([blog post](https://blackboard.sh/blog/electrobun-2-0/))
- **It is very fresh and churning.** 2.0.2 shipped on September 29, 2026, followed by ten 2.0.3 betas in four days.
- **It has open issues that would hit a daily-use tool** ([issues](https://github.com/blackboardsh/electrobun/issues)):
  - macOS webviews freeze after sleep (#550).
  - Native Wayland isn't supported on Linux (#568).
  - Builds don't work from Windows' Git Bash (#547).
  - Intel Macs were dropped (#560).
  - Builds crash intermittently (#564).
- **It no longer fits as well.** Electrobun 1.x was attractive because its main process *was* Bun: the server would have moved in unchanged. With Cottontail as the default, Specquer's Bun-specific code (`Bun.serve` HTML imports, `bun:sqlite`, `Bun.file`) would need checking against Cottontail. Choosing Bun instead brings back exactly the dependency the Electrobun author decided not to rely on.

## Bun Itself

The pinned Bun 1.4.2 is from after the Rust rewrite: reports say 1.4.0 was the first Rust release and 1.3.14 the last Zig one ([i-programmer](https://www.i-programmer.info/news/98-languages/19132-bun-14-rewritten-in-rust.html), [The Register](https://www.theregister.com/devops/2026/05/14/anthropics-bun-rust-rewrite-merged-at-speed-of-ai/5240381)). Reports differ on how fast it was done and how much was reviewed: the [Hacker News thread](https://news.ycombinator.com/item?id=48246917) describes a merge in days with little review, while [InfoQ](https://infoq.com/news/2026/09/bun-AI-rewrite-zig-rust-4-months) says four months of work. Upstream reports 128 old bugs fixed and slightly better performance.

Specquer depends on Bun far more than Electrobun did (runtime, bundler, single executable, dev server), so the concern that drove Electrobun away applies here too. The risk is lower because Specquer pins a version (in `mise.toml`) and doesn't embed Bun's internals. Still, keep 1.3.14 in mind as a fallback, and add tests that would catch a regression in a Bun upgrade.

## Comparison

| | Current (Bun server + browser) | Tauri 2 | Electrobun 2 |
|---|---|---|---|
| Languages | TypeScript only | Rust core plus TypeScript (breaks "one language") | TypeScript (Cottontail) or Bun |
| How Specquer's server would run | As is | As a **sidecar**: a compiled Bun binary started by Tauri | In the main process, if Cottontail is compatible, or under the Bun option |
| Maturity | Bun 1.4 is new; everything else is stable | Most mature: 2.x is long-lived and gets security audits | 2.0 shipped in late September 2026, with daily betas |
| Download size | About 80 MB (measured: 81 MB) | Under 1 MB for the shell, **plus** the ~80 MB Bun sidecar | Small shell plus its runtime |
| Rendering engine | The user's browser, usually Chromium | System webviews: WebKitGTK on Linux is the weak spot | System webviews or bundled Chromium |
| Native feel (menus, file dialogs, window, dock) | None | Good | Good, where it is stable |
| Launch "in the working directory" (spec) | Natural: it's a CLI | Needs a CLI launcher or a folder picker | Same as Tauri |
| Back/forward browser history (spec) | Built in | Has to be rebuilt in the app window | Same as Tauri |
| Several repositories at once | Several processes, so port handling is needed | One window per repository | Same as Tauri |
| Coding agents calling Specquer | Easy over HTTP | Needs a local HTTP port or an IPC bridge anyway | Same as Tauri |
| Remote / WSL / dev containers | Works with port forwarding | Awkward | Awkward |
| Local security | **Specquer's job**: the server can write files, so it needs a localhost-only listener, a per-session token and Origin/Host checks (against DNS rebinding) | Capability-based permissions built in | Basic |
| Installers, signing, auto-update | Built by hand (or ship the CLI binary only) | Built in | Built in |

## How This Maps to Specquer's Specification

- **Points for the current design:**
  - The [Ideas](/specifications/functionality/ideas) specification already assumes a browser. It calls for "Browser back and forward navigation" and autosaving "when the browser tab loses focus".
  - "The root folder is the working directory where the application was launched" describes a CLI tool.
  - Coding agents are listed as users, and an HTTP server suits them.
- **Points for a desktop shell:**
  - Business analysts and testers are also listed users. For them, a double-clickable app with an installer and a folder picker is friendlier than `cd repo && specquer`. If that audience matters, Tauri with a Bun sidecar is the safer shell today.
  - It costs a Rust toolchain and gives up most of Tauri's size advantage, but it reuses the same server and UI unchanged.

## Recommendation

1. **Keep the current architecture.** It is the only option that is single-language and single-executable today, and it fits the specification.
2. **Make it easy to add a shell later.** The UI should rely only on HTTP to its own server (no browser-only APIs it can't do without), and the server shouldn't assume a browser tab. Then wrapping it in Tauri or Electrobun is a packaging job, not a rewrite.
3. **Harden the localhost server now,** whatever is decided, since it can edit files: listen on localhost only, require a random session token in the launch URL, and check the Origin and Host headers.
4. **Look at Electrobun again in a few months.** Check whether Cottontail handles `Bun.serve` HTML imports and `bun:sqlite`, whether the issues above get fixed, and whether releases slow down.

## Sources

- [Electrobun 2.0 blog post (Blackboard)](https://blackboard.sh/blog/electrobun-2-0/)
- [Electrobun issues](https://github.com/blackboardsh/electrobun/issues)
- [Electrobun releases](https://github.com/blackboardsh/electrobun/releases)
- [Hacker News: Electrobun 2.0 decoupled from Bun](https://news.ycombinator.com/item?id=48246917)
- [Yoav on X](https://x.com/YoavCodes/status/2058064720553222567)
- [i-programmer: Bun 1.4 rewritten in Rust](https://www.i-programmer.info/news/98-languages/19132-bun-14-rewritten-in-rust.html)
- [InfoQ: Bun AI rewrite, Zig to Rust](https://infoq.com/news/2026/09/bun-AI-rewrite-zig-rust-4-months)
- [The Register: Bun Rust rewrite merged](https://www.theregister.com/devops/2026/05/14/anthropics-bun-rust-rewrite-merged-at-speed-of-ai/5240381)
- [Tauri 2 documentation](https://v2.tauri.app/start/)
