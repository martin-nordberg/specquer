<a id=""></a>

<a id=""></a>
# Step 009 - Implementation Plan

_Plan for the [One Specquer per Root Folder requirements](requirements.md). Drafted October 2026._

<a id=""></a>
## 1. Summary

At startup Specquer holds an exclusive SQLite lock on `.specquer/user/instance.lock` for the life of the process, and writes its URL to `.specquer/user/instance.json`. A second launch on the same root finds the lock taken, prints the running instance's URL, opens it, and exits with code 3.

There are four phases (§5):

1. the instance module;
2. wiring it into startup;
3. the end-to-end test;
4. documentation.

<a id=""></a>
## 2. Precedence

The requirements' Precedence table applies. This plan adds:

| Topic | Before | Step 009 (wins) |
|---|---|---|
| Startup order in `server/src/index.ts` | Parse the command line, resolve the root, create the app, listen | Parse, resolve, **take the lock**, create the app, listen, **write the instance file** (§4.2) |
| Signal handling | None; the process ends on SIGINT and SIGTERM | Handlers that delete the instance file, then exit (§4.2) |

<a id=""></a>
## 3. Starting Point

- **Startup** (`server/src/index.ts`):
  - `processState` (on `globalThis`) keeps the token and the opened-browser flag across `bun --hot` re-runs.
  - The command line is parsed and the root resolved to its real path; a `CliError` exits with code 2.
  - `createApp` builds the app, the section index and the summary service.
  - `serve()` listens on `--port`, or on 4870 with a fallback to a free port.
  - It then starts the scan, the cache purge and pre-filling, prints `Specquer is serving <root>` and `Open <url>`, and opens the browser.
- **The user folder** (`server/src/user-folder.ts`): `ensureUserFolder` creates `.specquer/user/` with its `.gitignore`.
- **Atomic writes:** `writeAtomically`, used by `uistate-store.ts`.
- **Launching the browser** (`server/src/launch.ts`): `openBrowser(url)`.
- **SQLite:** `bun:sqlite` is already used for the summary cache and embedded in the executable.
- **End-to-end fixtures** (`e2e/fixtures.ts`): `startSpecquer` spawns `bun src/index.ts <root> --no-open` and reads the URL from the `Open <url>` line.

<a id=""></a>
## 4. Proposed Design

<a id=""></a>
### 4.1 The Instance Module (`server/src/instance.ts`)

- **`acquireInstanceLock(root)`** returns one of:
  - `{ kind: "acquired", lock }`: `lock` holds the open `Database` and must stay referenced;
  - `{ kind: "taken", info }`: another process holds it; `info` is the parsed instance file, or `undefined`;
  - `{ kind: "unavailable", problem }`: the lock file couldn't be created or opened (R1.6).
- **Taking the lock:**
  1. `ensureUserFolder(join(root, ".specquer/user"))`.
  2. `new Database(path, { create: true })`, then `PRAGMA busy_timeout = 0` and `PRAGMA locking_mode = EXCLUSIVE`.
  3. `BEGIN EXCLUSIVE`, **left open** for the life of the process.
  4. `SQLITE_BUSY` means taken; any other error means unavailable.

  Checked by hand under Bun 1.4.2 on Linux: an open `BEGIN EXCLUSIVE` makes a second process get `SQLITE_BUSY` at once; `kill -9` releases it, and the leftover `instance.lock-journal` doesn't block the next instance. An empty `BEGIN EXCLUSIVE; COMMIT`, or a write followed by `COMMIT`, did **not** keep the lock in exclusive locking mode. So the transaction must stay open, and nothing else may use this database.
- **The instance file:**
  - `writeInstanceInfo(root, info)`: atomically, then `chmod 0600`, ignoring `chmod` failures on file systems without Unix modes.
  - `readInstanceInfo(root)`: parsed with a Zod schema (`pid`, `port`, `url`, `root`, `startedAt`). Missing or invalid gives `undefined`.
  - `removeInstanceInfo(root, pid)`: deletes the file only if it holds `pid`.
- **Why SQLite:** Bun has no file-lock API, and `flock` through `bun:ffi` wouldn't work on Windows. SQLite uses `fcntl` locks on macOS and Linux and `LockFileEx` on Windows, and `bun:sqlite` is already in the executable.

<a id=""></a>
### 4.2 Startup (`server/src/index.ts`)

1. After resolving the root, and before `createApp`: if `processState.specquerLock` is set (a `bun --hot` re-run), keep it. Otherwise call `acquireInstanceLock(root)`:
   - **acquired:** store the lock in `processState.specquerLock`, and delete a stale instance file (R2.1);
   - **taken:** hand over (step 2);
   - **unavailable:** print the warning and go on without a lock (D3).
2. **Hand-over** (`handOver(root, info, options)` in `instance.ts`, so it can be tested):
   - print `Specquer is already serving <root>` and `Open <url>`, plus a note when `--port` was given (D2);
   - unless `--no-open`, call `openBrowser(url)`;
   - without `info`, print the message of R3.4 instead and open nothing;
   - `process.exit(3)`.
3. After `serve()` and the `Open` line, write the instance file, once per process (`processState.specquerInfoWritten`).
4. Register handlers for `SIGINT` and `SIGTERM` (once per process) that call `removeInstanceInfo(root, process.pid)` and exit. Also call it from `process.on("exit")` for a normal exit. The lock needs no handler, since the operating system releases it.

<a id=""></a>
### 4.3 What Doesn't Change

- `createApp`, the routes, the section index and the summary service don't know about the lock, so unit and component tests are unaffected (R4.3).
- The token, the cookie and the launch URL stay as they are; the instance file stores the same URL.

<a id=""></a>
## 5. Phases

<a id=""></a>
### Phase 1: The Instance Module

- `server/src/instance.ts` as in §4.1, and `handOver`.
- `server/src/instance.test.ts`:
  - acquire, then a child process (`Bun.spawn` of a small script that tries the same lock) sees `taken`;
  - a child that holds the lock is killed with `SIGKILL`, then acquiring succeeds;
  - a second acquire in the same process while the first is held sees `taken`, which is why `bun --hot` must reuse the stored lock;
  - an unwritable `.specquer/user/` gives `unavailable`;
  - writing, reading and removing the instance file, its mode on POSIX, an invalid file read as `undefined`, and `removeInstanceInfo` leaving another process's file alone;
  - `handOver`'s output and exit code with and without `info`, and with `--port`, through injected `print`, `open` and `exit` functions.

<a id=""></a>
### Phase 2: Startup

- `server/src/index.ts` as in §4.2.
- Check by hand under `bun run dev`: editing a server file re-runs the module without losing the lock or rewriting the instance file. Ctrl+C removes `instance.json`. A second `bun server/src/index.ts .. --no-open` prints the dev server's URL and exits with code 3.

<a id=""></a>
### Phase 3: End-to-End Test

- `e2e/fixtures.ts`: `launchAgain(root)` spawns the same command as `startSpecquer` and resolves to `{ code, stdout }`.
- `e2e/launch.spec.ts`: on a running fixture, `launchAgain` exits with 3, its `Open` line is the fixture's URL, and the fixture's page still loads and saves afterwards.

<a id=""></a>
### Phase 4: Documentation

- The specifications listed in the requirements (§4).
- `CLAUDE.md`: in "Run it", a second launch on the same root opens the running instance and exits with code 3.
- The [Specification Gaps](/notes/specification-gaps) note: the two-instances item points to Step 009.

<a id=""></a>
## 6. Decisions

_Proposed_; the work proceeds on them unless they are changed:

- **P1. The lock lives in `.specquer/user/`**, not `.specquer/cache/`: it is per-user state, like `uistate.yaml`. Either folder is ignored by Git.
- **P2. The lock database holds no tables.** Its only use is the open transaction. Writing to it would risk ending the transaction by mistake, and the instance data goes in `instance.json`, which a second launch can read while the lock is held.
- **P3. The instance file is JSON**, not YAML: it is written and read only by Specquer, and `JSON.parse` with Zod is enough.
