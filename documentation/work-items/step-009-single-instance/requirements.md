<a id=""></a>

<a id=""></a>
# Step 009 - One Specquer per Root Folder

_Requirements for refusing a second Specquer on a root folder that one already serves, and handing the user over to the running one. Drafted October 2026._

<a id=""></a>
## 1. Summary

Specquer can run in several folders at once: without `--port`, a second instance falls back to a free port. Nothing stops two instances on the **same** root folder, and they would then interfere:

- **Section IDs:** each process allocates IDs "one update at a time" ([Server Requirements](/specifications/server-requirements) §7.3), but only within itself. Two processes can hand out the same number, which then shows up as a collision.
- **Data files:** both write `.specquer/shared/<prefix>/sections.yaml` from their own view of the files, and the last write wins.
- **UI state and the summary cache:** both write `uistate.yaml`, and both pre-fill and purge the cache.

Step 009 makes a root folder hold at most one Specquer. A second launch on the same root starts no server. Instead it hands the user over to the running instance: it prints that instance's URL and opens it in the browser, as a single-instance desktop application would.

<a id=""></a>
## 2. Precedence

Step 009 takes precedence over the specifications and earlier steps where they conflict:

| Topic | Before | Step 009 (wins) |
|---|---|---|
| A second launch on the same root | Starts a second server on a free port | Starts no server; prints the running instance's URL, opens it unless `--no-open` is given, and exits with code 3 (R3) |
| `.specquer/user/` | `uistate.yaml`, the personal `agent.config.yaml` | Also `instance.lock` and `instance.json` (R1, R2) |
| Where the session token is kept | Only in the server's memory and the launch URL | Also in `.specquer/user/instance.json`, readable only by the user (R2) |

<a id=""></a>
## 3. Requirements

<a id=""></a>
### R1. The Instance Lock

1. Before it serves anything, reads the section data or writes any file other than the lock, Specquer takes an exclusive lock on `.specquer/user/instance.lock` under the root folder. It creates `.specquer/user/` (with its `.gitignore`) if needed.
2. The lock belongs to the operating system: it is released when the process ends, however it ends (a normal exit, Ctrl+C, a crash, `kill -9`). A lock left by a dead process never blocks a later launch, and no file needs cleaning up by hand.
3. The root is the folder's real path (as today, Server Requirements §1), so two launches that name the same folder through different paths or symbolic links find the same lock.
4. The lock covers one root folder exactly. Instances on a folder and on a folder inside it are not stopped by this step (see §5).
5. Under `bun --hot` (development), re-running the server module keeps the lock the process already holds and doesn't try to take it again.
6. **The lock can't be taken for a reason other than another instance** (a read-only folder, missing permissions): Specquer prints a warning naming the file and the reason, and starts without the lock. It doesn't refuse to start, so read-only use of a folder keeps working (D3).

<a id=""></a>
### R2. The Instance File

1. Once it holds the lock, Specquer deletes any `.specquer/user/instance.json` left by an earlier run. Once it listens, it writes a new one, atomically: `{ pid, port, url, root, startedAt }`, where `url` is the launch URL with the session token.
2. The file is readable and writable by its owner only (mode `0600` where the file system supports it). `.specquer/user/` is ignored by Git, and the file API can't reach `.specquer/` (Security §5).
3. On a clean shutdown (SIGINT, SIGTERM, the process exiting normally) Specquer deletes the file if it still holds its own `pid`. After a crash the file stays, and the next instance replaces it (R2.1).
4. Under `bun --hot`, the file keeps the URL from the process's first run, since the token and the port don't change.

<a id=""></a>
### R3. A Second Launch

1. When the lock is held by another process, the launch starts no server, reads no section data and writes nothing.
2. If `instance.json` holds a URL, it prints:

   ```
   Specquer is already serving <root>
   Open <url>
   ```

   The second line has the same form as a normal launch's, so a coding agent or script that reads the URL from the output gets the running instance's URL.
3. Unless `--no-open` is given, it opens that URL in the browser, as a normal launch does (Server Requirements §2.3).
4. If `instance.json` is missing or unreadable (the other instance is still starting, or it couldn't write the file), it prints that Specquer is already running on the root and names the lock file, opens nothing, and exits.
5. It exits with code 3 in both cases (D1). Code 2 stays for command-line errors.
6. `--port` doesn't change this: a second launch with `--port` hands over to the running instance whatever its port, and says that `--port` was ignored (D2).

<a id=""></a>
### R4. Tests

1. Unit tests: taking the lock, a second attempt failing while it is held by another process, the lock being free again after that process is killed (`SIGKILL`), the instance file's contents and mode, and deleting a stale file.
2. End-to-end test: a second launch on a running fixture's root exits with code 3, prints the first instance's URL, and leaves the running instance working.
3. `createApp` and the unit tests that build an app don't take the lock, so tests can create several apps on one root in one process.

<a id=""></a>
## 4. Specifications to Update

- **[Server Requirements](/specifications/server-requirements):** §1 (exit code 3), §2 (the lock, the instance file, the hand-over).
- **[Security](/specifications/security):** §3, the token in `instance.json` and who can read it; §8, the lock protecting the data files.
- **[Information Architecture](/specifications/info-architecture):** the `.specquer/user/` entries in the folder diagram.
- **[Technical Architecture](/specifications/technical-architecture):** §5, the lock through `bun:sqlite`.
- **`CLAUDE.md`:** the "Run it" command's behavior with a running instance.
- **[Specification Gaps](/notes/specification-gaps):** the item on two Specquers on one root.

<a id=""></a>
## 5. Decision Points

Decided while proposing the step:

- **Hand over rather than fail.** A second launch is almost always the user forgetting that one is running, so it opens the running instance.
- **An operating-system lock, not a PID file.** A PID file goes stale after a crash, and process IDs are reused. The lock is released by the operating system (R1.2).
- **Nested roots are out of scope.** An instance on the repository and another on `documentation/` lock different folders. The inner one keeps its own `.specquer/` and its own section IDs, which is a separate problem, recorded in the [Specification Gaps](/notes/specification-gaps).

_Proposed_; the work proceeds on them unless they are changed:

- **D1. Exit code 3 after a hand-over.** The launch started nothing, so a script that ran it to start a server should be able to tell. The `Open <url>` line still gives the URL. The alternative, exit code 0, treats the hand-over as success.
- **D2. `--port` is ignored with a warning** when another instance runs, rather than starting a second one on that port or failing.
- **D3. Start without the lock when it can't be created** (R1.6), with a warning. Refusing to start would block read-only use of a folder for a case that rarely matters there.

<a id=""></a>
## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| File locks are unreliable on some network file systems (NFS, SMB) | Two instances on a shared folder aren't stopped | Documented as a limitation; Specquer works on local folders |
| The token is stored on disk | Another program running as the same user can read it | Such a program can already read and write the specs themselves; the file is the owner's only and ignored by Git |
| A crash leaves `instance.json` | A stale URL could be printed | The next instance deletes it as soon as it holds the lock (R2.1), and a launch reads it only while the lock is held |
| Windows ignores Unix file modes | `instance.json` is readable by whatever the folder's permissions allow | The user's folders are normally private to them; recorded in Security §3 |
