<a id="WORK-00270" data-uid="p74rxp33sizb"></a>

<a id="WORK-00271" data-uid="zsh8mb2r124t"></a>
# Nested Specquer Repositories

When Specquer starts, it looks for .specquer folders in every parent folder
of its configured working directory. Behavior then depends upon what is found:
* **No .specquer at any level**
  - Current working directory remains as specified
  - New .specquer folder is initialized as now
* **One .specquer folder in the specified working directory**
  - Current working directory remains as specified
  - Specquer opens the repository as now
* **One .specquer folder in some parent of the working directory**
  - The current working directory is automatically changed to the
    parent of the one .specquer folder.
  - A warning to that effect is logged
  - Specquer opens as if that parent folder had been its input configured
    working directory
* **Two or more .specquer folders**
  - An error is logged that Specquer cannot run against a nested Specquer
    repository
  - The server exits with an error code for the purpose

Documentation is updated accordingly.

<a id="WORK-00272" data-uid="gr1978ttpwmf"></a>
## 1. Summary

Step 009 keeps a second Specquer off a root folder that one already serves. It doesn't cover roots that overlap. Today, launching in `documentation/` while the repository root holds `.specquer/` starts a second, independent Specquer. It has its own `.specquer/` inside `documentation/`, its own `sections.yaml` files and its own section numbering, all for files the outer one also sections. This continuation makes Specquer find the Specquer folder that a launch belongs to before it takes the instance lock:

| Found from the given folder upwards | Effect |
|---|---|
| No `.specquer/` | The given folder is the root; `.specquer/` is created there as now |
| `.specquer/` in the given folder only | The given folder is the root, as now |
| `.specquer/` in one folder above it only | That folder becomes the root, with a warning |
| `.specquer/` in two or more of these folders | An error; Specquer exits with code 4 |

Moving the root up happens before the instance lock (Step 009 R1). So a launch in a subfolder of a root that a running Specquer serves hands over to that instance, as a second launch on the root itself does.

<a id="WORK-00273" data-uid="s6r0wu8p8i27"></a>
## 2. Starting Point

- **`server/src/cli.ts`:** `resolveRoot(root, cwd)` resolves the given folder to its real path, and fails with a `CliError` (exit code 2) if it doesn't exist or isn't a folder.
- **`server/src/index.ts`:** parses the command line, calls `resolveRoot`, then takes the instance lock with `acquireInstanceLock(root)`. That call creates `.specquer/user/` at startup, so every launch now leaves a `.specquer/` behind.
- **`server/src/git.ts`:** `gitInfo(root)` runs `git rev-parse --is-inside-work-tree --show-prefix`; `null` outside a work tree or without Git.
- **`server/src/files.ts`:** the tree never lists a `.specquer` folder at any depth (`SKIPPED_FOLDERS`). A `.specquer/` below the root is therefore invisible, but the Markdown files beside it are listed and sectioned by the outer root.

<a id="WORK-00274" data-uid="ztiihvaahsw3"></a>
## 3. Proposed Design

<a id="WORK-00275" data-uid="u9fzwc4bbxo4"></a>
### 3.1 Finding the Root (`server/src/root.ts`)

- **`findSpecquerRoot(given, options)`** takes the real path from `resolveRoot` and resolves to one of:
  - `{ kind: "given", root }`: no `.specquer/` was found, or only in `given` itself;
  - `{ kind: "parent", root, given }`: one `.specquer/` was found, in a folder above `given`;
  - `{ kind: "nested", folders }`: two or more were found; `folders` lists them, innermost first.
- **The search** checks `given` and then each folder above it, one level at a time. A `.specquer` entry counts only when it is a folder; `stat` follows a symbolic link to one.
- **Where it stops** (D1): at the top of the Git work tree that `given` is in (`git rev-parse --show-toplevel`), checked last. Outside Git, or without Git, it goes up to the root of the file system. Without this bound, a `.specquer/` left in the home folder by one launch there would capture every later launch under it.
- `options` takes the Git top level and a `stat` function, so the tests can drive the search on temporary folders.

<a id="WORK-00276" data-uid="mlkin11lyd6p"></a>
### 3.2 Startup (`server/src/index.ts`)

1. Parse the command line and call `resolveRoot`, as now.
2. Call `findSpecquerRoot`:
   - **given:** carry on with that root;
   - **parent:** print `Specquer found .specquer/ in <root>; serving that folder instead of <given>.` on standard error, and carry on with the parent as the root;
   - **nested:** print an error naming every `.specquer/` folder found and saying that Specquer can't run inside a nested Specquer folder (remove the inner one, or launch elsewhere), then exit with code 4 (D3). Nothing is locked, created or written.
3. Take the instance lock on the root found, as in Step 009. A launch moved up to a running instance's root hands over to it, with exit code 3.
4. `Specquer is serving <root>` names the root actually served, so a script reading the output sees the change.

<a id="WORK-00277" data-uid="kvhz2zqkegso"></a>
### 3.3 `.specquer/` Below the Root (D2)

The requirements above look only upwards. The reverse case is the same overlap seen from the outer root: launching at the repository root while `documentation/.specquer/` exists. The outer Specquer then sections `documentation/`'s files with its own data files, and the inner one's `sections.yaml` files are silently ignored.

- **Proposed:** once the tree listing has run, the section index looks for `.specquer` folders below the root and reports each one in the log. With Git, `git ls-files` for `*/.specquer/shared/*` finds the committed ones; without Git, the walk already passes them. Section problems then lists them as "nested Specquer folder", and the user decides which to delete.
- It is a report, not a refusal, because a `.specquer/` below the root is often a leftover (a launch in the wrong folder before this continuation) that the user needs to see in order to remove it.

<a id="WORK-00278" data-uid="spnc4hc0tr8e"></a>
## 4. Phases

<a id="WORK-00279" data-uid="xzw3t0rf4y3b"></a>
### Phase 1: Finding the Root

- `server/src/root.ts` as in §3.1, and `gitTopLevel(folder)` in `git.ts`.
- `server/src/root.test.ts`, on temporary folders:
  - none found;
  - in the given folder;
  - in the parent and in the grandparent;
  - in the given folder and a parent (nested);
  - two parents (nested);
  - a `.specquer` file rather than a folder (ignored);
  - a symbolic link to a folder (counts);
  - a `.specquer/` above the Git top level (ignored);
  - without Git (the search goes to the file-system root, bounded in the test by an injected top).

<a id="WORK-00280" data-uid="o4n6sujufluc"></a>
### Phase 2: Startup

- `server/src/index.ts` as in §3.2, with `NESTED_SPECQUER_EXIT = 4` next to `ALREADY_RUNNING_EXIT`.
- **Check by hand:**
  - `bun server/src/index.ts documentation --no-open` from the repository serves the repository root, with the warning;
  - with `bun run dev` running, the same command hands over to it (exit code 3);
  - a scratch `documentation/.specquer/` gives exit code 4 and writes nothing.

<a id="WORK-00281" data-uid="u9ihbe4zxs0b"></a>
### Phase 3: End-to-End Tests

- In `e2e/launch.spec.ts`, on a running fixture:
  - `launchAgain(join(root, "docs"))` exits with 3 and prints the fixture's URL, because the launch moved up to the root, which is already served;
  - after creating `docs/.specquer/`, the same launch exits with 4 and prints both folders.

<a id="WORK-00282" data-uid="j70shair9967"></a>
### Phase 4: `.specquer/` Below the Root

Only if D2 is accepted:

- the index's check;
- the problem kind in `GET /api/sections/problems` and the **Section problems** dialog;
- a test in `sections-api.test.ts` and in `SectionProblems.test.tsx`.

<a id="WORK-00283" data-uid="y6omkrasptui"></a>
### Phase 5: Documentation

- **[Server Requirements](/specifications/server-requirements):** §1, how the root is found and exit code 4; §2, the order: find the root, then lock.
- **[Information Architecture](/specifications/info-architecture):** the root folder's definition ("the folder Specquer was launched in") becomes the folder holding the `.specquer/` found.
- **[Client Requirements](/specifications/client-requirements) §3.5 and [Data Architecture](/specifications/data-architecture) §2.6:** the nested Specquer folder problem, if D2 is accepted.
- **[Step 009 requirements](requirements.md):** the decision "Nested roots are out of scope" points here.
- **[Specification Gaps](/notes/specification-gaps):** the nested-roots remark.
- **`CLAUDE.md`:** the "Run it" command: a launch in a subfolder serves the Specquer root above it, and exit code 4.

<a id="WORK-00284" data-uid="fujduhg2vatc"></a>
## 5. Decisions

_Proposed_; the work proceeds on them unless they are changed:

- **D1. The search stops at the Git work tree's top level.** A repository is the unit a team shares, and `.specquer/shared/` is committed with it. A `.specquer/` outside the repository (in the home folder, say) belongs to another root and mustn't capture this one. Outside Git there is no such boundary, so the search goes to the file-system root.
- **D2. A `.specquer/` below the root is reported, not refused** (§3.3), as a section problem and in the log.
- **D3. Exit code 4 for a nested Specquer folder.** Code 2 stays for command-line errors and code 3 for a hand-over to a running instance.
- **D4. The tree doesn't open at the given folder.** After moving up, the tree opens as it would for the root (the last open file, the expanded folders). Expanding and selecting the folder the user launched in would need a way to pass it to the client, and can come later.

<a id="WORK-00285" data-uid="ht9eud6uvybw"></a>
## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A stray `.specquer/` above a project outside Git | Launches there are moved up to the wrong folder | The warning names the folder; inside Git the search stops at the repository's top (D1) |
| An existing nested `.specquer/` (from launches before this step) | Specquer refuses to start there with exit code 4 | The error names both folders and says to remove the inner one; its `sections.yaml` files may hold IDs worth checking first |
| A Git submodule with its own `.specquer/` inside a repository that has one | The submodule's top level ends the search, so it runs as its own root | Intended: a submodule is its own repository. From the outer root, D2 reports it |
| Searching upwards on a slow network file system | Slower startup | One `stat` per level, at most a few dozen |
