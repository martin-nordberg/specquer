<a id="WORK-00207" data-uid="lnj6dzerzlpy"></a>

Provide a way for the user to change the system settings and the per-folder settings interactively, instead of editing the YAML files by hand.

<a id="WORK-00309" data-uid="v38x4p2dvkns"></a>
# Scope

* In scope: the settings in the agent configuration (`agent.config.yaml`, shared and personal) and each folder's entry in the prefix configuration (`section-prefixes.config.yaml`).
* Out of scope: tabs beyond "Model" and "Summarization"; editing the keys for single files (such as `documentation/notes/ideas.md`); editing `documents.yaml` or the `sections.yaml` files; providers other than NVIDIA.
* The YAML files stay the source of truth. Editing them by hand keeps working, and the dialogs show their current content.

<a id="WORK-00208" data-uid="elym4bw5ij31"></a>
# System Settings

<a id="WORK-00209" data-uid="ad3b4lkteywy"></a>
## Settings

* Every setting now in `agent.config.yaml`:
  * Model tab: `model.provider` (shown read only; only `nvidia` in this version), `model.name` (free text: the provider's model ID; Specquer offers no built-in list of model IDs), `model.baseUrl` (an http or https URL), `model.apiKeyEnv` (the name of the environment variable that holds the API key).
  * Summarization tab: `summaries.concurrency` (1 to 16), `summaries.tokenBudget` (1,000 to 1,000,000), `summaries.prefill` (on or off).
* The dialog never asks for, shows or stores an API key, only the variable's name. Next to the name it says whether the variable is set in the server's environment ("found" or "not set").
* The model status the server already reports (enabled, or the problem that disables summaries) is shown on the Model tab.
* A **Test** button on the Model tab makes one small call to the model with the values as entered, saved or not, to check the name, URL and key together. The prompt is a fixed short text that holds nothing from the specs. The result says whether the call succeeded, with the model's response time, or shows the provider's error (an unknown model, a rejected key, an unreachable URL). The call times out after 30 seconds, isn't cached, and can be cancelled. It is the only model call other than summaries; it sends the key named by `apiKeyEnv` to the URL entered, as saving those values would.

<a id="WORK-00310" data-uid="bx481k0nwlfu"></a>
## Shared and personal settings

* Each tab has a switch between **Shared** (`.specquer/shared/agent.config.yaml`, committed, applies to everyone using the repository) and **Personal** (`.specquer/user/agent.config.yaml`, this user only, overrides the shared file). It starts on **Personal**.
* Each value shows where the value in effect comes from: the shared file, the personal file or the default. In **Personal**, a value can be reset, which removes it from the personal file so the shared value applies again.
* `model:` is merged as a whole (a personal `model:` replaces the shared one), so saving any model setting in **Personal** writes the complete `model:` block to the personal file, copying the values not changed from the shared file.
* Switching `summaries.prefill` on shows the warning from Security §"Pre-filling": the server will send every sectioned spec to the model provider in the background, again after each change. In **Shared** it also says that this applies to everyone who pulls the change, and asks for confirmation.

<a id="WORK-00210" data-uid="d5g61y06sxng"></a>
## UI

* A new gear icon button just right of the light/dark mode toggle, with the accessible name "Settings".
* It opens a modal dialog with the settings as editable values.
* The dialog is divided into tabs: "Model" and "Summarization", with room for more tabs later.
* **Save** and **Cancel** buttons. Invalid values are reported next to the field, using the same Zod schemas as the server (`agent/src/config.ts`), and **Save** stays disabled while any value is invalid.

<a id="WORK-00211" data-uid="rmcxu55nfr8d"></a>
## Restarts

* No setting needs a restart, with one exception. Both agent configuration files are already read again when their modification time changes; a changed model is resolved again on the next call, a change to `prefill` or to the model restarts pre-filling, and `concurrency` applies from the next call.
* The exception: the server reads the environment once, at startup (including `server/.env`). Pointing `apiKeyEnv` at a variable that was not set then has no effect until Specquer is restarted. The dialog says so when the variable is "not set".

<a id="WORK-00212" data-uid="d437kkyia5ej"></a>
# Folder Settings

<a id="WORK-00213" data-uid="somhy5gg0p0w"></a>
## Settings

* **Sectioned** (Specquer adds section anchors to its Markdown files) with three choices:
  * **Inherited**: the folder has no entry of its own and follows the nearest parent folder that has one. The dialog shows what that is, e.g. "Inherited from `documentation/`: sectioned, prefix SPEC" or "Inherited: not sectioned".
  * **Yes**: the folder has its own entry with a prefix.
  * **No**: the folder has its own entry saying it is not sectioned, even inside a sectioned parent.
* **Prefix** for new sections in the folder: required for **Yes**, hidden otherwise. Its format is the section ID prefix (`[A-Z][A-Z0-9]{1,4}`). Several folders may share a prefix; they then share its sequence of numbers.
* **Add section anchors…**: an action in the dialog (not a setting). It opens the existing **Add section anchors** dialog for the folder (recursively), with its dry run listing the files that will change and its `AGENTS.md` checkbox. After a save that switches a folder from **No** or not-sectioned **Inherited** to sectioned, the settings dialog offers it.

<a id="WORK-00311" data-uid="f6qz85rklvyc"></a>
## Effects on existing sections

* Changing a folder's prefix only affects sections created afterwards. Existing sections keep their IDs; the old prefix stays known through its `sections.yaml`, so a folder can mix prefixes, as a moved file does today.
* Making a folder not sectioned leaves the anchors in its files unchanged. Its documents and sections are removed from the data files and their sections are retired (Data Architecture §2.5, rule 4).
* Making it sectioned again restores them: a section with its retired ID and UID moves back from `retired`, with its ID unchanged. No ID is renumbered.

<a id="WORK-00312" data-uid="dh3kkztwqc1y"></a>
## Prefix configuration changes

* The prefix configuration needs a way to say "not sectioned" for a folder inside a sectioned folder. It is the value `null` (`"documentation/work-items/archive/": null`). A `null` entry is matched by the longest-key rule like any other, and a file it matches is not sectioned.
* `PrefixConfig`, its parsing and Data Architecture §2.2 change to match. A `null` entry does not count as naming a prefix.
* **Inherited** removes the folder's own key; **Yes** and **No** write it. Keys for single files are left alone, and the dialog lists the ones inside the folder (read only).

<a id="WORK-00214" data-uid="egqtkmwjl1dq"></a>
## UI

* Right-clicking a folder offers **Settings…** (with a gear icon). For the root folder it is on the menu for the tree's empty space, like the other root folder items.
* **Add section anchors…** is removed from the context menu; it is reached through **Settings…**.
* **Section problems…** stays in the context menu.
* **Save** and **Cancel** buttons, with invalid values reported next to the field as in the system settings.

<a id="WORK-00313" data-uid="a8l9os805b6h"></a>
# Writing the configuration files

* The server gets an API to read and write the two agent configuration files and the folder entries of the prefix configuration. The API accepts only these settings, validated with the Zod schemas; it never takes a file path or arbitrary YAML.
* Files are edited with the `yaml` package's document API, so comments, key order and keys Specquer doesn't know are kept. They are written atomically, and only when their content changes. A personal file that doesn't exist yet is created.
* Each read returns a version (as file saves do). Saving with an old version, because the file changed on disk while the dialog was open (a pull, or an edit by hand), answers with a conflict. The dialog then reloads the values and says that the file changed.

<a id="WORK-00314" data-uid="yt7l4eryp6qo"></a>
# Specifications to update

* Client requirements: the settings dialog and its gear button; the folder context menu (**Settings…** instead of **Add section anchors…**); **Add section anchors** reached from the folder settings.
* Security §5: the settings API writes only the three configuration files, and only the settings named above. "Section anchors change files only when the user does": **Add section anchors** is now reached through **Settings…**. "Pre-filling": the confirmation for the shared file. The model test call: a fixed prompt with no spec content, sent with the key to the URL entered.
* Data Architecture §2.2: `null` entries in the prefix configuration.
* Technical Architecture: the settings API, the configuration writer and the model test call.
