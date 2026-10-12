<a id=""></a>

<a id=""></a>
# Step 006 - Implementation Plan

_Plan for the [Settings requirements](requirements.md). Drafted October 2026._

<a id=""></a>
## 1. Summary

Step 006 lets the user change settings in dialogs instead of in YAML files:

- **System settings**: a gear button next to the theme toggle opens a dialog with two tabs, "Model" and "Summarization". It edits the shared or the personal `agent.config.yaml`, shows where each value in effect comes from, and has a **Test** button for the model.
- **Folder settings**: **Settings…** in a folder's context menu edits the folder's entry in `section-prefixes.config.yaml`: inherited, sectioned with a prefix, or not sectioned. **Add section anchors…** moves into this dialog.
- **The prefix configuration** gains `null` entries, so a folder inside a sectioned folder can be left unsectioned.
- **The server** gains a settings API that writes only these three files, through the `yaml` document API so comments survive, with versions so a file changed on disk is not overwritten.

There are five phases (§5): the configuration formats and writers, the API, the two dialogs, then the documentation. Decisions taken while planning are in §6, marked _Proposed_; the work proceeds on them unless they are changed.

<a id=""></a>
## 2. Precedence

Step 006 takes precedence over the specifications and earlier steps where they conflict:

| Topic | Before | Step 006 (wins) |
|---|---|---|
| Prefix configuration values | A prefix | A prefix, or `null` for "not sectioned" |
| Which files are sectioned | Those matching a key | Those whose longest matching key has a prefix |
| Configuration files | Read by Specquer, edited by hand | Also written by the settings API |
| What the server writes | `.md` files, `uistate.yaml`, the section data files, `AGENTS.md` | Also the two `agent.config.yaml` files and `section-prefixes.config.yaml` |
| Folder context menu | **Add section anchors…** | **Settings…**, which leads to **Add section anchors** |
| Model calls | Summaries only | Summaries and the model test |

<a id=""></a>
## 3. Starting Point

- **Agent configuration** (`agent/src/config.ts`): `modelConfigSchema` and `summariesConfigSchema` (Zod), `parseAgentConfig` (drops invalid values with a warning) and `mergeAgentConfig` (personal `summaries:` key by key, personal `model:` as a whole). The schemas live in `agent`, which the client must not depend on.
- **Reading it** (`server/src/summaries/config.ts`): `AgentConfigFiles` reads each file again when its modification time changes. `SummaryService.current()` resolves the model again when the configuration or the key changes, restarts pre-filling, and takes `concurrency`. Keys come from `options.env ?? process.env`, read at startup.
- **The model** (`agent/src/model.ts`): `createChatModel(config, env)` builds `ChatOpenAI` with a 120-second timeout and one retry; `SummaryServiceOptions.createModel` lets tests inject a fake.
- **Prefix configuration** (`server/src/sections/config.ts`): `parsePrefixConfig` rejects any value that isn't a prefix; `PrefixConfig.prefixFor` uses the longest matching key; `PrefixConfigFile` reads again on a new modification time. `SectionIndex` reconciles on scan, retiring the sections of documents that are no longer sectioned (Data Architecture §2.5, rule 4) and restoring a retired ID found with its retired UID.
- **Writing files** (`server/src/files.ts`): `writeAtomically` and `contentVersion`; saves answer `conflict` when the base version is stale. `UiStateStore` creates `.specquer/user/` with its `.gitignore`.
- **Client** (`client/src/app/App.tsx`): `ThemeToggle` in the header; `FileTree`'s `onAddAnchors` opens `AnchorDialog` (dry run, then run, with the `AGENTS.md` checkbox). The shadcn components in `client/src/components/ui` have no tabs, radio group, switch or label yet; `radix-ui` has them all.
- **End-to-end** (`e2e/fake-model.ts`): a fake OpenAI-compatible server answering `POST /v1/chat/completions`.

<a id=""></a>
## 4. Proposed Design

<a id=""></a>
### 4.1 Shared Settings Schemas (`shared/src/settings/`)

A new subpath export, `@specquer/shared/settings`:

- `modelConfigSchema`, `summariesConfigSchema` and their types, moved from `agent/src/config.ts`, which imports and re-exports them (D1). `parseAgentConfig` and `mergeAgentConfig` stay in `agent`.
- `folderSettingSchema`: `{ kind: "inherit" } | { kind: "off" } | { kind: "prefix", prefix }`, with the prefix checked by `isPrefix` from `/sections`.
- The request and response schemas of §4.4, in `shared/src/api/schemas.ts` as now, built from these.

<a id=""></a>
### 4.2 `null` in the Prefix Configuration (`server/src/sections/config.ts`)

- `parsePrefixConfig` accepts `null` (and an empty value, which YAML reads as `null`) as "not sectioned". Rules become `{ key, prefix: string | null }`.
- `prefixFor` takes the longest matching key as now and returns its prefix, or `undefined` when it is `null`. A file key under a `null` folder, or a subfolder key under it, sections its files again.
- `prefixes()` leaves `null` out, so it never counts as a known prefix.
- `PrefixConfig` gains `entryFor(folder)` (the folder's own entry, if any), `inheritedFor(folder)` (the nearest ancestor's key and value, or none) and `fileKeysIn(folder)`, for the dialog.

<a id=""></a>
### 4.3 Configuration Writers (`server/src/settings/`)

A new folder, with one module per file kind and a small common part:

- **Common** (`yaml-file.ts`): read the file's bytes and version (`contentVersion`, or `""` for a missing file), parse with `parseDocument`, apply edits, write with `writeAtomically` only when `doc.toString()` differs. A stale base version answers `conflict` with the current version. A file with YAML syntax errors is not written: the answer is `invalid`, with the first error and the file's path (D4). All writes go through one queue, so two saves never interleave.
- **Agent configuration** (`agent-config-writer.ts`): `readAgentSettings()` returns, for each file, its version, the values it sets (after `parseAgentConfig`) and its warnings; plus the merged values, each value's source (`shared`, `personal` or `default`) and the summary status. `writeAgentSettings(scope, baseVersion, edits)` sets or deletes `model` (a whole block, or `null` to remove it) and each `summaries.*` key (`null` removes it), keeping every other key and comment. Writing the personal file creates `.specquer/user/` and its `.gitignore` as `UiStateStore` does (shared helper).
- **Prefix configuration** (`prefix-config-writer.ts`): `readFolderSettings(folder)` returns the folder's own entry, the inherited one, the file keys inside it and the file's version. `writeFolderSetting(folder, setting, baseVersion)` finds the pair whose key normalizes to the folder (whatever its spelling, such as `./documentation/`), then replaces its value, writes `null`, or deletes the pair. A new key is added at the end of `prefixes:`, spelled as the folder path with its trailing `/`; the root folder's key is `./` (D8). A missing `prefixes:` mapping, or a missing file, is created.
- **Freshness**: after a write, the writer tells `AgentConfigFiles` and `PrefixConfigFile` to forget their stamps (D5), so the next read sees the new content even if the modification time didn't change.

<a id=""></a>
### 4.4 Settings API (`shared/src/api/`, `server/src/app.ts`)

All routes are under `/api/settings`, behind the session token, Host and Origin checks like every API route, and validated with `@hono/zod-validator`.

| Route | Does |
|---|---|
| `GET /settings/agent` | `readAgentSettings()`, plus whether each `apiKeyEnv` named in either file is set |
| `PUT /settings/agent` | `{ scope, baseVersion, model?, summaries? }` → `{ ok: true, version }`, or `conflict`, or `invalid` |
| `GET /settings/env?name=` | `{ set: boolean }` for a name matching the `apiKeyEnv` pattern; never the value (D9) |
| `POST /settings/model-test` | A `ModelConfig` → `{ ok: true, ms }` or `{ ok: false, problem }`; aborted when the request is |
| `GET /settings/folder?path=` | `readFolderSettings(path)` |
| `PUT /settings/folder` | `{ path, setting, baseVersion }` → `{ ok: true, version, sectioned }`, or `conflict`, or `invalid` |

- `path` follows the workspace path rules (`/paths`) and must be an existing folder inside the root (`FileService`), or the root itself.
- After a folder setting is saved, the handler starts a section scan and `summaries.filesChanged()`, as `getTree` does, so sections are retired or restored at once. `sectioned` says whether the folder is sectioned now, for the dialog's offer to add anchors.
- After agent settings are saved, the client asks for the summary status again (the preview enables or disables the slider from it).

<a id=""></a>
### 4.5 Model Test (`agent/src/model.ts`, `server/src/settings/model-test.ts`)

- `createChatModel` takes optional overrides for `timeout` and `maxRetries`. `testModel(config, env, signal)` builds the model with a 30-second timeout and no retries, and invokes it with a fixed prompt ("Reply with the word OK.") holding nothing from the specs. It returns the time taken, or a problem (D7):

| Failure | Problem shown |
|---|---|
| Key variable not set | "The environment variable NAME isn't set. Restart Specquer after setting it." |
| 401 or 403 | The provider rejected the API key |
| 404 | The provider doesn't know the model |
| Connection refused, DNS, TLS | The URL can't be reached |
| Timeout | No answer within 30 seconds |
| Anything else | The provider's message |

- Provider messages are shown as plain text, with the key's value replaced by `***` if it appears.
- One test runs at a time: a new test aborts the one running. The test doesn't go through the summary queue or the cache.
- The server uses `SummaryServiceOptions.createModel` here too, so tests inject the fake model.

<a id=""></a>
### 4.6 System Settings Dialog (`client/src/components/settings/`)

- **Components**: `tabs`, `radio-group`, `switch` and `label` copied from shadcn into `client/src/components/ui`, on `radix-ui`.
- **Button**: `SettingsButton` (gear icon, accessible name "Settings") right of `ThemeToggle` in `App.tsx`.
- **Dialog**: `SettingsDialog` loads `GET /settings/agent` on open and holds the edits. Each tab has its **Shared / Personal** segmented control, starting on **Personal**; switching scope with unsaved changes on that tab asks to discard them (D6).
- **Values**: each field shows its source as a small badge ("Shared", "Personal", "Default"). In **Personal**, **Reset** removes the value from the personal file; on the Model tab it resets the whole `model:` block, since the personal block replaces the shared one whole.
- **Model tab**: provider (read only), name, base URL, key variable with "found / not set" (checked through `/settings/env` as the name changes, debounced), the restart note when "not set", the model status, and **Test** with its result and **Cancel** while running.
- **Summarization tab**: concurrency, token budget, prefill. Switching prefill on shows the pre-filling warning inline; saving it on in **Shared** asks for confirmation in a second dialog that says it applies to everyone who pulls the change.
- **Saving**: the edits are grouped by file and sent as one `PUT` per file, the second with the version the first returned if both go to one file. A `conflict` reloads the values and says the file changed; an `invalid` shows the YAML error and the file's path. Values are checked with the shared schemas as they are typed; **Save** stays disabled while any is invalid. Warnings from the files (values ignored as invalid) are listed at the top of the tab.

<a id=""></a>
### 4.7 Folder Settings Dialog (`client/src/components/settings/FolderSettingsDialog.tsx`)

- **Menu**: `FileTree` replaces `onAddAnchors` with `onFolderSettings` (**Settings…**, gear icon) in the folder menu and the root folder's empty-space menu. **Section problems…** stays.
- **Dialog**: **Sectioned** as a radio group: **Inherited** (with what it inherits: "from `documentation/`: sectioned, prefix SPEC" or "not sectioned"), **Yes**, **No**. **Prefix** shows for **Yes**, checked with `isPrefix`. File keys inside the folder are listed read only, with a note that they are edited in the YAML file.
- **Add section anchors…**: a button in the dialog, enabled while the folder is sectioned with the saved settings. It closes this dialog and opens `AnchorDialog` for the folder, unchanged.
- **After saving**: when the folder became sectioned, the dialog stays open on a short note offering **Add section anchors…** and **Close**. When it stopped being sectioned, the note says the anchors stay in the files and the sections come back with their IDs if it is sectioned again.
- **Conflicts and errors** as in §4.6.

<a id=""></a>
### 4.8 Security

- The settings API writes only `.specquer/shared/agent.config.yaml`, `.specquer/user/agent.config.yaml` and `.specquer/shared/section-prefixes.config.yaml`, at fixed paths; requests never carry a file path for these, only a folder path for the prefix key, confined like every path.
- Only the settings in the schemas can be written; other keys in the files are kept as they are.
- No route takes, returns or stores an API key; `/settings/env` returns only whether a variable is set.
- The model test sends the key named by `apiKeyEnv` to the URL entered, as saving that configuration would, with a fixed prompt and no spec text.
- Saving `prefill: true` to the shared file needs a second confirmation.

<a id=""></a>
## 5. Phases

Each phase lists its tasks and what "done" means. Tests are written within each phase.

<a id=""></a>
### Phase 1 - Formats and Writers

- `shared/src/settings/` with the schemas moved from `agent`; `null` entries in `PrefixConfig`; `server/src/settings/` with the writers and the stamp reset.
- Tests:
  - Prefix configuration: a `null` folder inside a sectioned folder; a subfolder key and a file key under a `null` folder; `null` never a known prefix; `entryFor`, `inheritedFor`, `fileKeysIn`.
  - Writers: comments, key order and unknown keys survive; a key spelled `./documentation/` is found and edited in place; the root key; removing a pair; a missing file or `prefixes:` is created; the personal file and its `.gitignore` are created; a stale version answers `conflict`; a YAML syntax error answers `invalid` and leaves the file alone; nothing is written when nothing changes; a write is read back at once even within the same millisecond.
  - Sections: turning a folder off retires its sections and writes no Markdown file; turning it back on restores every ID unchanged, with no renumbering.
- *Done when* `bun test` and `bun run typecheck` pass.

<a id=""></a>
### Phase 2 - Settings API and Model Test

- The routes and schemas of §4.4, the handlers in `server/src/app.ts`, `testModel` and the overrides in `createChatModel`, the scan and `filesChanged` after a folder save.
- Tests: each route with valid and invalid input; a folder path outside the root, or a file, is refused; the env route never returns a value; a saved model change shows in `/summaries/status` at once; the model test with a fake model (success, each failure of §4.5, abort, the key redacted from a message); a second test aborts the first.
- *Done when* the API tests pass and no route writes outside the three files (checked by a test that snapshots the root before and after).

<a id=""></a>
### Phase 3 - System Settings Dialog

- The shadcn components, `SettingsButton`, `SettingsDialog` and its tabs, the status refresh after saving.
- Component tests: sources shown per value; **Reset** in **Personal**; the whole `model:` block written for one changed field; switching scope with unsaved changes asks; invalid values disable **Save**; the prefill warning, and the confirmation in **Shared**; a conflict reloads; **Test** shows success and each failure, and can be cancelled.
- End-to-end: change the model name to the fake model's through the dialog in **Personal**, see the slider work without a restart and the shared file untouched; **Test** against the fake model server.
- *Done when* the component and end-to-end tests pass on Chrome and WebKit.

<a id=""></a>
### Phase 4 - Folder Settings Dialog

- **Settings…** in both menus, `FolderSettingsDialog`, the hand-off to `AnchorDialog`, the notes after saving; `onAddAnchors` removed from `FileTree`.
- Component tests: the inherited description; the prefix shown only for **Yes** and checked; file keys listed; **Add section anchors…** enabled only while sectioned; the offer after a folder becomes sectioned.
- End-to-end: in a temporary repository, set a subfolder to **No**, create a file there and see no anchor added; set it back to **Inherited** and see the earlier sections keep their IDs; give a new folder a prefix and add anchors from the dialog.
- *Done when* the component and end-to-end tests pass on Chrome and WebKit, and the existing **Add section anchors** tests pass through the new path.

<a id=""></a>
### Phase 5 - Documentation

- Link the requirements and this plan in the VitePress sidebar ("006-Settings").
- **[Client Requirements](/specifications/client-requirements):** the settings button and dialog, the folder context menu, **Add section anchors** reached from the folder settings.
- **[Server Requirements](/specifications/server-requirements):** the settings routes and the model test.
- **[Data Architecture](/specifications/data-architecture):** `null` entries in the prefix configuration (§2.2); the configuration files as written by Specquer.
- **[Security](/specifications/security):** §4.8.
- **[Technical Architecture](/specifications/technical-architecture):** `server/src/settings/`, `shared/src/settings/`, the model test.
- `CLAUDE.md`: the `settings/` folder, the `/settings` subpath export, and the schemas' move from `agent` to `shared`.
- A Step 006 implementation status section at the end of this plan.

<a id=""></a>
## 6. Decision Points

Taken while planning; each is _Proposed_ and the work proceeds on it unless changed.

- **D1. Schemas in `shared`.** _Proposed:_ the client validates with the same schemas as the server (requirements), and it can't depend on `agent`; `agent` re-exports them, so its callers don't change.
- **D2. One route per file kind, `null` to remove.** _Proposed:_ the edits name the settings, not the file's structure; `null` removes a key so the value from the shared file or the default applies.
- **D3. Versions.** _Proposed:_ the same content hash as file saves, with `""` for a missing file, so creating the personal file is a save against `""`.
- **D4. Broken YAML isn't rewritten.** _Proposed:_ the `yaml` document of a file with syntax errors can't be edited safely; the user fixes it by hand, and the dialog says where.
- **D5. Writers reset the readers' stamps.** _Proposed:_ the readers compare modification times only, and a write within the same millisecond as the last one would go unseen.
- **D6. Scope switch with unsaved changes asks to discard.** _Proposed:_ keeping edits for both scopes at once would make it unclear which file **Save** writes.
- **D7. The model test.** _Proposed:_ a fixed prompt, 30 seconds, no retries, one at a time, outside the summary queue, with failures mapped to the messages in §4.5.
- **D8. Spelling of new keys.** _Proposed:_ the folder path with its trailing `/`, and `./` for the root; existing keys keep their spelling.
- **D9. The env check.** _Proposed:_ a route that answers only whether a variable with a valid name is set, so the dialog can say "found / not set" as the name is typed.
- **D10. Invalid values in the files.** _Proposed:_ shown as warnings and left in the file unless the user saves that setting, which replaces them.

<a id=""></a>
## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The writer reformats a hand-edited file | Noisy diffs in a committed file | `yaml` document API; tests with comments, quoting and key order |
| Prefill switched on in the shared file by mistake | Every teammate's specs go to the provider | Off by default, warning, second confirmation for **Shared** |
| A teammate on an older Specquer reads a `null` entry | The entry is ignored with a warning; the folder is sectioned for them and their saves add anchors | Note in the Data Architecture; the anchors are harmless, and retired sections still restore |
| Turning a folder off by mistake | Its sections are retired | Turning it back on restores every ID; the note after saving says so |
| The model test sends the key to a mistyped URL | The key reaches another host | The same as saving that URL; only http(s) URLs pass the schema; the dialog shows the URL next to **Test** |
| A file changes on disk while the dialog is open | A pull is overwritten | Versions; a conflict reloads the values |

<a id=""></a>
## 8. Implementation Status

Phases 1 to 5 were carried out in October 2026. What differs from the plan, or was learned doing it:

1. **Files** (§4.3): the writers are `server/src/settings/agent-settings.ts` and `folder-settings.ts`, on a common `yaml-file.ts` (`YamlFile`, `WriteQueue`). Creating `.specquer/user/` with its `.gitignore` moved from `UiStateStore` to `server/src/user-folder.ts`, which both use. A save that would leave a new file empty creates no file.
2. **Keeping the file's text**: a changed value is set on its scalar in place, so a comment after it survives; unchanged values aren't touched at all. Removing every personal setting leaves an empty mapping (`{}`) in the personal file.
3. **Freshness** (D5): `SectionIndex.configChanged()` and `SummaryService.configChanged()` make the readers forget their stamps; the handlers call them after a write.
4. **Saving both tabs** (§4.6): the two tabs' changes to the same file go in one `PUT`, rather than two with the version chained; changes to different files are two `PUT`s.
5. **The folder save** (§4.4) rescans before answering, and `sectioned` comes from the file as written, so the dialog's offer to add anchors and the anchor dialog's dry run see the new configuration.
6. **The model test** (§4.5): `createChatModel` takes `{ timeout, maxRetries }`; `testModel` and `modelTestProblem` are in `agent/src/model.ts`, and `SummaryService.testModel` keeps one running. A test stopped by a newer one answers "Stopped: another test started." instead of an error. Failures are recognized by status (401, 403, 404, 429), LangChain's error codes and the OpenAI client's error names.
7. **The env check** (D9) runs 300 ms after typing pauses, seeded from the variables `GET /api/settings/agent` already reported.
8. **Section numbers in the specifications**: the prefix configuration is Data Architecture §2.3 (not §2.2). The client requirements gained §3.6 (folder settings) and §10 (settings); the server requirements gained §9 (settings), and other routes became §10.
9. **Tests.** Unit and component tests pass (415), and the end-to-end suite passes on Chrome and WebKit (106), with `e2e/settings.spec.ts` covering a personal model set and tested in the dialog, a model error, a folder switched off and back on (IDs kept), and a new folder given a prefix and anchored from the dialog.

