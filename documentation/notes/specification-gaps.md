<a id=""></a>

<a id=""></a>
# Gaps in the Specifications

_Notes from October 2026, after Step 008._

**Summary:** the specifications in `documentation/specifications/` describe what Specquer does today in detail: every API route is specified, and the sections and summaries are specified down to their rules. What's missing falls into four groups. Three of the four features the [overview](/specifications/overview) promises have no specification. Several behaviors at the edges (two Specquers on one folder, a server restart under an open tab, a file changed on disk while open) aren't stated. There are no non-functional requirements beyond security. And a few passages are out of date after Steps 005 to 008.

<a id=""></a>
## Features Promised but Not Specified

- **Traceability.** The overview lists "navigation among sections of interrelated spec documents in the sense of requirements traceability". The specifications cover only links to sections (completion, scrolling to a section) and the `<a name="r7k2" data-status="draft">` traceability anchors that the sanitizer keeps. Nothing says what a trace is, how it is shown or which reports exist. [Traceability Links](/notes/traceability-links) has ideas.
- **Updating baseline specs from change specs.** The overview promises "automated synchronization of parallel specs". Folder types exist, but [Data Architecture](/specifications/data-architecture) §2.1 says the three sectioned types "for now, behave alike". The update mechanism is only in the unnumbered [Dual Documentation](/work-items/step-TBD-dual-docs/requirements) work item.
- **What the folder types mean.** Even before any update mechanism, there's no spec for what makes a file Baseline, Change or Auxiliary beyond one line each. For example: are Auxiliary specs read as context but never edited? Can a section of a change spec link to a baseline section, and how?
- **The lookup's users.** `GET /api/summaries/sections/:id` exists "for link previews and reports to come", and neither is specified.
- **"Later" items.** Data Architecture §1.1 lists rewriting the Markdown tree (renames, link updates) and collapsing individual sections as later work. Nothing says whether links to a renamed or deleted file are updated, reported or left broken. Today they are left broken, without a warning.

<a id=""></a>
## Behaviors Not Stated

- **Two Specquers on one root folder.** The command line lets Specquer run in several folders at once, and nothing stops two instances on the same folder: the second one falls back to a free port. Section IDs are allocated "one update at a time" in one process only ([Server Requirements](/specifications/server-requirements) §7.3), so two processes could issue the same number. The specs should either forbid it (a lock file in `.specquer/`) or say that reconciliation reports the collision.
- **A restart under an open tab.** The session token is new at each start ([Security](/specifications/security) §3), so a tab left open across a restart gets `401` for every request. The client requirements don't say what the user sees, whether unsaved edits are at risk, or how to get back in, other than opening the newly printed URL.
- **The server going away.** Likewise for a stopped server: the save status shows "Save failed", but nothing says whether autosave keeps retrying, or what happens to unsaved edits when the page then closes.
- **The open file changed on disk without edits.** §8 of Security and §7 of the client requirements cover a conflict on save. Nothing says whether an open file that the user hasn't edited is reloaded when a coding agent changes it, or stays stale until the user types. The client checks only the summary status on focus.
- **The tree changing on disk.** Likewise, whether the folder tree notices files added or removed outside Specquer (a reload on focus, a button, a file watcher) isn't specified.
- **Size limits.** The tree is limited to 10,000 files and a summary request to 1 MB. Nothing limits the size of a file opened or saved, or says how the editors, the preview worker and Milkdown behave on a very large spec.
- **Without Git.** Several rules depend on Git (the tree listing, the delete preview, telling an original from a copy). Outside a repository is covered. A `git` binary missing from the `PATH` inside a repository isn't.
- **Platforms.** Case-only renames are covered. Other Windows and macOS behavior isn't: paths with reserved names (`CON`, `aux.md`), Unicode normalization of file names, and symbolic links that need privileges.

<a id=""></a>
## Missing Non-Functional Requirements

- **Accessibility.** Only the slider, badges, the drag bars and the palette's contrast are specified. There's no overall target (for example WCAG 2.2 AA) and nothing on keyboard use of the folder tree and its context menu, focus handling in dialogs, or screen reader labels for the editors.
- **Supported browsers and platforms.** The end-to-end tests run Chrome and WebKit, but no spec says which browsers, operating systems and CPU architectures are supported or which executables a release builds.
- **Performance.** A few figures appear in passing (a scan in about 50 ms, the preview within 250 ms of typing, 80 ms of parsing for a 2,400-line spec). There are no targets: startup time, time to open a file, the largest repository supported.
- **Logging.** Many rules say "reported in the log" or "on the console", but nothing says where the log is, its format or level, or whether the release executable writes it anywhere but standard output.
- **Distribution and upgrades.** Nothing covers how users get the executable, how they learn of a new version, or how an older Specquer behaves with data files from a newer one.
- **Data format versions.** `uistate.yaml` has a `version` and the summary cache a `user_version`. `sections.yaml`, `.specquer-config.yaml` and `agent.config.yaml` have none, and nothing says how a format change to them would be rolled out. These are committed files that several Specquer versions on one team will read.
- **Language of the interface.** The UI is in English only, and summaries follow the text's language. This isn't stated, and neither is whether the UI will be localized.
- **Privacy.** Security §9 covers what is sent to the model provider. Nothing states that Specquer itself collects no telemetry, although that is true and users will ask.

<a id=""></a>
## Out of Date or Inconsistent

- [Information Architecture](/specifications/info-architecture) §1 says summaries are "cached for 30 days". Everywhere else they are kept until unused for 60 days.
- [Technical Architecture](/specifications/technical-architecture) §4 lists the shared package's exports without `@specquer/shared/summaries`, and describes `/settings` as holding "a folder's prefix setting", which predates Step 008's folder type. §5's Settings row says "the folders' prefix entries" in the same way.
- Data Architecture §1.1 is headed "Now (Steps 001 to 004)", and it points to §1.6 for the outline, which is in §1.5 (§1.6 is the tests).
- The introductions of [Client Requirements](/specifications/client-requirements) and Server Requirements name the steps they came from, but stop at Step 003 and Step 002. Later steps changed both. The client introduction is also missing a comma before "[Step 002]".
- Security's introduction names the files that implement and test it, but not `server/src/settings/` or the settings tests, although §5 and §8 cover the settings routes.
- The [Glossary](/references/glossary) isn't linked from the overview or the specifications. Terms such as section, prefix, placeholder and folder type are defined in Data Architecture §2.1 instead.

<a id=""></a>
## Suggested Order

1. Fix the out-of-date passages. They are small, and readers trust the specs as written.
2. Specify two Specquers on one root and a restart under an open tab, since both can lose work or issue duplicate IDs.
3. Write down the meaning of the folder types before the dual-documentation step builds on them.
4. Add a short non-functional requirements specification (accessibility target, supported platforms, logging, format versions, no telemetry).
