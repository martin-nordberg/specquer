<a id="NOTE-00105" data-uid="cnk1629zdyiq"></a>

<a id="NOTE-00106" data-uid="ow7ol57t1czk"></a>
# Specquer Driving Coding Agents

_Notes from October 2026, after Step 013. A brainstorm, not a design; revised with answers to its first open questions._

**Summary:** Specquer knows things a coding agent has to be told: the section in view, its ID, status and prefix, whether its folder holds baseline or change specs, its open comment threads, and what has changed since the last commit. Specquer could turn that knowledge into well-defined tasks for the user's own agent (Claude Code, Codex and others). The agent keeps running in its own terminal. Specquer never runs it headless and never hosts it.

- **Prompts:** Specquer writes each task as a prompt file. A **recipe** generates it, either on request or when a section's status changes. The user can look at and edit each prompt in Specquer before sending it.
- **The queue:** sending a prompt puts it in a queue, and the running agent picks it up. Specquer keeps the queue and a log of what is pending, in progress and completed.
- **Recipes** live in `.specquer/shared/recipes/`. Each one says which prefixes and which status transitions it applies to, and the last status in a prefix's list counts as final.
- **Picking up:** the most reliable way to hand a prompt to a running agent is still for the agent to pull it. That takes one short command typed in its terminal, or, in Claude Code, a background wait or a hook that picks the next prompt up without typing. ACP doesn't fit this, because it can't reach a session running in another terminal.
- **Review:** start with Git tools plus a read-only view of the changes by section in Specquer, and add follow-up prompts from review comments.
- **GitHub:** handing a prompt to a cloud agent through a GitHub issue is possible as a later, opt-in target for the same prompt file.

<a id="NOTE-00123" data-uid="ikjbdw8hnbdc"></a>
## Decisions So Far

| Question | Decision |
|---|---|
| A headless agent run from Specquer? | No. The agent runs in its own terminal, with the user's own settings and permissions, and the user can steer it. |
| How do tasks reach the agent? | Specquer generates prompts. It shows them for viewing and editing, sends them to a queue the agent picks up from, and logs each one: pending, in progress, completed. |
| Where do recipes live? | In the shared folder, `.specquer/shared/recipes/`, related to status transitions and differing by prefix. |
| Which status is final? | Per prefix: the last in its list, as the first is the starting status. |

<a id="NOTE-00107" data-uid="bga6302t848b"></a>
## Why Specquer Would Prepare the Task

Today the user switches to the agent's terminal and writes the instructions by hand: which file, which section, what to keep, what the anchor rules are. The same few requests come back again and again. This repository shows the pattern: each step folder goes from requirements to an implementation plan, then code, then updates to the specifications and to `CLAUDE.md`. Each of those steps starts with a similar prompt.

Specquer can fill in what those prompts need from what it already knows:

- the selected section and its extent, including subsections;
- the section's ID, UID, status and prefix, and the statuses the prefix allows;
- the folder type (`BASELINE`, `CHANGE`, `AUXILIARY`);
- the section's comment threads;
- sections that link to it, and sections it links to;
- uncommitted changes and section problems.

After a run, Specquer can check the result in ways the agent can't. `SectionIndex` reports changed, copied or invented IDs, and the server reports damaged sidecars.

<a id="NOTE-00108" data-uid="lisls0pu54vy"></a>
## Ways to Reach the Agent

<a id="NOTE-00109" data-uid="foiskuepultz"></a>
### 1. Copy a Prompt

Specquer fills in the recipe and puts the prompt on the clipboard, and the user pastes it into their running agent.

- No integration, and it works with every agent.
- The user stays in their usual tool, with its permissions and history.
- Specquer doesn't see the run, so it can only check the result when the files change.

This stays useful as a fallback for any agent the queue doesn't support, and as the cheapest way to try recipes.

<a id="NOTE-00110" data-uid="uprf4dz8jy33"></a>
### 2. Open the Agent in a Terminal

Specquer opens a new terminal running the agent with the prompt as its first message, for example `claude "<prompt>"`. The session is the agent's normal, interactive user interface. But it is a new session each time, not the one the user already has open, and opening a terminal differs between operating systems. This could be a choice offered next to **Send**, but it isn't the main path.

<a id="NOTE-00111" data-uid="iyjs55s7mdew"></a>
### 3. Headless Runs: Rejected

Most agents have a non-interactive mode (`claude -p`, `codex exec`) that Specquer could spawn. This is ruled out, for three reasons:

- **No steering:** a headless run can't ask for permission halfway through, so its allowed tools would have to be fixed in advance, and the user can't steer it.
- **The user's own setup is lost:** the user's terminal session carries their settings, approvals and context.
- **Specquer would become an agent host:** it would need one adapter per agent's flags and event format.

<a id="NOTE-00112" data-uid="hgsb8lb0u7ba"></a>
### 4. The Agent Client Protocol (ACP): Doesn't Fit

ACP is a JSON-RPC protocol over stdio, started by Zed, through which an editor drives an agent. Gemini CLI supports it natively, and adapters exist for Claude Code and Codex.

**Could ACP be used just to trigger the pick-up?** Not for a session the user already runs:

- **It only reaches sessions the client started.** In ACP the client starts the agent as its own subprocess and owns that session (`session/new`, then `session/prompt`). It has no way to reach an agent running in another terminal.
- **Loading a session doesn't help either.** Some agents can load a saved session (`session/load`), but that starts a second process with a copy of the history, which then diverges from the one in the terminal.
- **Starting a session "only to trigger" undoes the decision.** The work would then happen in Specquer's hidden session, not the terminal: in effect a headless run with a permission dialog.

ACP would make sense only if Specquer one day hosted the conversation itself, as Zed does, which is what the decision above rules out.

<a id="NOTE-00113" data-uid="b0wg0lick913"></a>
### 5. A Queue the Agent Picks Up From: Chosen

Specquer writes prompts to a queue, and the running agent takes them from it, through a small CLI (or an MCP server) that claims, reports on and completes each one. This works with any agent that can run a command. It keeps the agent in its own terminal, and it lets Specquer log every prompt. The next sections describe it: the queue, how the agent learns there is something to pick up, the prompt file and the log.

<a id="NOTE-00114" data-uid="t4o13wmhh815"></a>
### Side by Side

| | Copy prompt | New terminal | Headless | ACP | Queue |
|---|---|---|---|---|---|
| Uses the session the user has open | Yes | No | No | No | Yes |
| Agents covered | All | Those with a CLI | One adapter each | Those with ACP support | Any that can run a command |
| Specquer sees progress | No | No | Yes | Yes | Through the agent's reports and hooks |
| User can steer mid-run | Yes | Yes | No | Through Specquer | Yes |
| Decision | Fallback | Optional | Rejected | Doesn't fit | Chosen |

<a id="NOTE-00124" data-uid="klr2t92q2kkj"></a>
## The Prompt Queue

<a id="NOTE-00125" data-uid="lw4p96o6ejwb"></a>
### A Prompt's Life

```
draft ──Send──▶ pending ──agent claims──▶ in progress ──▶ completed
  │               │                         │  ▲
  └──Discard      └──Cancel                 │  └── answered
                                            ├──▶ waiting  (asked a question in a comment thread)
                                            └──▶ failed   (the agent gave up, or the checks failed)
```

- **Draft:** a recipe made it, on request or on a status change. Nothing has been sent, and the user can read and edit the whole prompt, or discard it. Reading it is also the user's best defense against text in a spec that tries to steer the agent (see Guardrails).
- **Pending:** the user pressed **Send**, and the prompt waits for an agent.
- **In progress:** an agent claimed it. The claim records which agent and session, and when.
- **Waiting:** the agent raised a question as a comment thread ([Coding Agents in Comment Threads](/notes/agent-comments)) and stopped. An answer in the thread moves the prompt back to pending, so the same session or another one can continue.
- **Completed or failed:** the agent reported its result, and Specquer ran its checks (section problems, damaged sidecars, files changed outside the recipe's scope). Failed checks mark the prompt failed even if the agent said it succeeded.
- **Cancelled:** the user withdrew it before or during the work. An agent that is still working learns this the next time it reports.

<a id="NOTE-00126" data-uid="dwx7dm1xivfo"></a>
### In Specquer

- **A Prompts pane** in the third pane's place, beside AI Chat and Comments. It lists prompts grouped by state, shows the filled-in prompt for editing (Specquer already edits Markdown), and offers **Send**, **Cancel**, **Retry** and **Copy**.
- **Recipes** are offered in the section badge's menu (**Run recipe…**), on the file tree and in a command palette. A recipe triggered by a status change shows as a draft, with a pip on the section.
- **The log** of each prompt shows its timeline, the agent's notes, what changed and the check results (see below).

<a id="NOTE-00127" data-uid="pkom0kqcfrtv"></a>
### The Agent's Side

A small command set in the `specquer` executable, the same one [Coding Agents in Comment Threads](/notes/agent-comments) proposes for comments:

```
specquer prompts next [--wait]            claim the oldest pending prompt and print it
specquer prompts note <prompt> "…"        add a progress note
specquer prompts waiting <prompt> --thread <thread UID>
specquer prompts done <prompt> --summary "…"
specquer prompts fail <prompt> --reason "…"
```

Claims, notes and results go through the running Specquer when there is one, so a prompt can't be claimed twice. Without a running Specquer, they are written straight to the files. One line in the agent guide tells agents these commands exist. Agents never edit the prompt files' state by hand.

<a id="NOTE-00128" data-uid="zwtmfr5xax2o"></a>
## Telling the Running Agent There Is Work

The agent is busy, or idle and waiting for the user's input, in a terminal Specquer doesn't control. The options, from most to least portable:

1. **The user asks.** One short command in the terminal: a "do the next Specquer prompt" request, exported as the agent's own command (`/specquer-next` in Claude Code's `.claude/commands/`, a Codex custom prompt). The command runs `specquer prompts next`. This works with every agent today, and the user stays in control of when work starts.
2. **The agent keeps going.** Claude Code's `Stop` hook runs when the agent finishes a turn, and can block the stop with a reason, which the agent then acts on. A hook that runs `specquer prompts next` and passes on a pending prompt makes a session work through the queue until it is empty. This only fires when a turn ends, so it doesn't wake an idle session.
3. **The agent waits in the background.** The agent starts `specquer prompts next --wait` as a background command. The command exits, printing the prompt, as soon as one is sent. In Claude Code a background command that exits wakes the session, so an idle session picks up a prompt the moment the user presses **Send**. Other agents differ, so check each one.
4. **Specquer tells the session at start.** Claude Code's `SessionStart` hook adds its output to the session's context: "There are 2 pending Specquer prompts; run `/specquer-next` to start one."
5. **Push into the session.** Claude Code has a research-preview feature, at the time of writing, through which an MCP server can push messages into a running session. Specquer could push "a prompt was sent" that way. Its status and API should be checked before relying on it.
6. **Type into the terminal.** If the agent runs inside `tmux`, Specquer could type a line into it with `tmux send-keys`. This works with any agent, but it is fragile: it types into whatever has the focus, even halfway through the user's own input.

Recommendation: start with (1) for every agent. Add (2) and (3) for Claude Code, since they need only hooks, commands and the same CLI. Keep an eye on (5). Avoid (6) unless users ask for it.

<a id="NOTE-00129" data-uid="xodfqh71vvw0"></a>
## The Prompt File

Prompts are kept per user in `.specquer/user/prompts/`, which is not committed: the queue belongs to this user's agent. Some ideas for the format follow.

<a id="NOTE-00130" data-uid="tqw89m53p9wo"></a>
### Option A: One Markdown File per Prompt

The front matter holds the metadata and state, and the body holds the prompt itself. The user edits the body in Specquer like any document, and the agent reads it like any Markdown.

````markdown
---
prompt: p3x9k2m7q1wz            # a UID, as Specquer issues them
title: Fold Step 013 into the baseline
recipe: fold-into-baseline
recipeVersion: 9f2c41e0          # hash of the approved recipe it came from
state: pending                   # draft | pending | in-progress | waiting | completed | failed | cancelled
createdAt: "2026-10-15T14:02:11Z"
createdBy: Martin Nordberg
trigger:
  kind: status                   # or: manual
  section: WORK-00534
  sectionUid: h818es2fvd3s
  from: Testing
  to: Complete
target:
  document: documentation/work-items/step-013-code-review/code-review.md
  sections: [WORK-00538, WORK-00540, WORK-00541]
scope:                           # checked after the run
  edit: [documentation/specifications/**]
  comment: [documentation/work-items/step-013-code-review/**]
baseCommit: 74364a8
claim:                           # written by `specquer prompts next`
  agent: claude-code 2.x
  session: 7c536167-6274-4b38-b5a5-0184b1048622
  claimedAt: "2026-10-15T14:05:40Z"
---
# Fold Step 013 into the baseline

The specs in this repository are managed by Specquer. Follow the section anchor
rules in AGENTS.md. Never change a section's status.

## Task

Carry the fixes recorded in the change document below into the baseline
specifications. First list the baseline sections you will change, add or remove,
one line each, and wait for confirmation.

## Material

- Change document: documentation/work-items/step-013-code-review/code-review.md
  (sections WORK-00538, WORK-00540, WORK-00541)
- Baseline sections it links to: SPEC-00211 (security §9), SPEC-00157
- Closest matches in the search index: SPEC-00160, SPEC-00302

## When you are done

Run `specquer prompts done p3x9k2m7q1wz --summary "…"`. If you need a decision,
open a comment thread with `specquer comment add` and run
`specquer prompts waiting p3x9k2m7q1wz --thread <thread UID>`.
````

- **For:** one file per prompt that is readable and editable anywhere, Git-friendly if a prompt is ever shared, and the agent can be told to read it in place.
- **Against:** the state sits in the same file the user edits. That is fine as long as only the CLI and Specquer change the front matter, through the same version checks as other writes.

<a id="NOTE-00131" data-uid="il5goqlv8b9k"></a>
### Option B: A Folder per Prompt

`prompts/p3x9k2m7q1wz/` holds:

- `prompt.md`: the body only;
- `meta.yaml`: what the front matter holds above;
- `log.jsonl`: the log;
- `changes.patch`: the diff at completion.

This keeps the user's text apart from the machine-written state and gives larger artifacts a home. It means more files to keep consistent.

<a id="NOTE-00132" data-uid="xyp0zho0q8i7"></a>
### Option C: State as Folders

`prompts/pending/`, `prompts/in-progress/`, `prompts/done/`, as in Maildir. Claiming means renaming a file from `pending/` into `in-progress/`. A rename within one file system is atomic, so two agents can't both claim the same prompt even without a running Specquer, and `ls` shows the queue. On the other hand, a prompt's path changes with its state, and the state lives in two places if the file also records it.

<a id="NOTE-00133" data-uid="vx7js62nbshf"></a>
### Suggestion

Option A for the prompt, a `<prompt>.log.jsonl` beside it for the log, and claims through the CLI, which also handles the case without a running Specquer by locking the file. Option C's atomic rename is worth keeping in mind if claims without a running Specquer turn out to matter.

<a id="NOTE-00134" data-uid="z987ebldzkzf"></a>
## What the Log Can Hold

Each prompt gets a log: a timeline of entries in `<prompt>.log.jsonl`, shown in the Prompts pane.

```jsonl
{"at":"2026-10-15T14:02:11Z","by":"specquer","event":"created","trigger":"status WORK-00534 Testing→Complete"}
{"at":"2026-10-15T14:03:02Z","by":"Martin Nordberg","event":"sent"}
{"at":"2026-10-15T14:05:40Z","by":"agent","event":"claimed","agent":"claude-code","session":"7c53…","transcript":"~/.claude/projects/-code-specquer/7c53….jsonl"}
{"at":"2026-10-15T14:07:12Z","by":"agent","event":"note","text":"Plan: change SPEC-00211 and SPEC-00157; add one section under SPEC-00160."}
{"at":"2026-10-15T14:07:13Z","by":"hook","event":"edit","file":"documentation/specifications/security.md"}
{"at":"2026-10-15T14:19:55Z","by":"agent","event":"done","summary":"Updated §9 and §5; added 'Shared approvals'."}
{"at":"2026-10-15T14:19:57Z","by":"specquer","event":"checked","sectionProblems":0,"outsideScope":[],"sections":{"changed":["SPEC-00211","SPEC-00157"],"added":1}}
```

Where each kind of entry can come from:

| Source | What it gives | Available |
|---|---|---|
| **Specquer itself** | State changes and times; the commit at claim and at completion; files and sections changed, by UID, so moves and rewordings are told apart; comment threads opened; check results | Always |
| **The agent's reports through the CLI** | The plan, progress notes, the final summary, questions raised, proposed status changes | When the agent follows the instructions; it can forget |
| **The agent's hooks** | Claude Code's hooks give the session ID and the transcript's path, and each tool call (files read and edited, commands run) as it happens | Claude Code, where the user installs the hooks; other agents differ |
| **The agent's transcript** | Everything: messages, reasoning shown to the user, every tool call and its output | A path to it: Claude Code keeps transcripts under `~/.claude/projects/`, Codex under `~/.codex/sessions/` |
| **Git** | The commits made during the run and their diff | When the agent commits |

Some things are worth not storing:

- **The transcript itself:** keep only a pointer. A transcript can be large, can hold other work done in the same session, and can hold secrets that appeared in command output. An **Excerpt** action could copy the part between the claim and the completion, when asked.
- **Cost and tokens:** these aren't generally available to hooks. Record them only if an agent reports them.

<a id="NOTE-00115" data-uid="qs10h368pmie"></a>
## Recipes

A recipe is a named, repeatable task that generates a prompt, defined by:

- **a scope:** a section, a document, a folder or the selected text;
- **the prefixes it applies to:** recipes differ by requirement type;
- **status transitions that offer it,** as a draft;
- **a prompt template** with fields Specquer fills in: `{{section.id}}`, `{{section.markdown}}`, `{{file}}`, `{{threads}}`, `{{links}}`, `{{changedFiles}}`, `{{allowedStatuses}}`;
- **what the agent may touch:** files (this document only, the baseline folder, comments only);
- **the expected result:** edits, comment threads, a report, or a new document;
- **checks after the run:** no section problems, no files changed outside the allowed scope, sidecars still valid.

Shared recipes live in `.specquer/shared/recipes/`, one Markdown file each, committed. Personal ones live in `.specquer/user/recipes/`. Specquer could also export recipes as the agents' own commands and skills, so the same recipe works when typed in the agent.

<a id="NOTE-00135" data-uid="nkuaaq4dm6it"></a>
### Prefixes and Status Transitions

A prefix's statuses come from `.specquer/shared/<prefix>/prefix.config.yaml`, or the defaults. The **first** status is the starting one, and the **last** is final: `Complete` for the defaults (Draft, Approved, In Development, Peer Review, Testing, Complete), and `Archived` for this repository's `NOTE` prefix (Draft, Archived). `final` in a recipe means the last status of the section's prefix, so one recipe works across prefixes with different lists.

A recipe file declares where it applies:

```markdown
---
title: Fold into baseline
prefixes: [WORK]
folderTypes: [CHANGE]
scope: document              # offered once per document, for the sections that moved
on:
  - to: final                # any transition into the last status
  - from: Testing
    to: final
when: all-sections-final     # or: each-section
edit: [documentation/specifications/**]
---
Carry the change in {{file}} (sections {{sections.ids}}) into the baseline…
```

Examples, by prefix, for this repository:

| Prefix | Transition | Recipe |
|---|---|---|
| `WORK` (change items) | → final (`Complete`) | **Fold into baseline** |
| `WORK` | → `Approved` | **Hand off for implementation** |
| `WORK` | → `Peer Review` | **Find gaps**: open comment threads, no edits |
| `SPEC` (baseline) | → `Approved` | **Draft a test plan** |
| `DEFN` (definitions) | → `Approved` | **Glossary terms**: link or flag uses of the term across the specs |
| `NOTE` | → final (`Archived`) | None by default. An "extract decisions into the specs" recipe is possible |

How transitions are detected and offered:

- **Detection:** Specquer compares each section's status, by UID, between the saved file and the file it saves. This covers the section attributes dialog and edits typed in either view. A status that changed back before saving is no transition.
- **Own edits only:** transitions that arrive through `git pull` or another person's edits don't make drafts. Their author may have run the recipe already.
- **Inherited statuses:** a section without its own `data-status` inherits within its prefix (`sectionStatuses`). A recipe with `when: all-sections-final` looks at statuses after inheritance.
- **Batching:** setting several sections to final in one document makes one draft, not one per section, when the recipe's scope is the document.
- **Drafts only:** a transition makes a draft. A person sends it.

<a id="NOTE-00116" data-uid="lfwk1gwkhs2p"></a>
### Recipe Ideas

**Writing and tidying**
- **Clarify:** tighten a section's wording without changing what it requires; list anything it had to interpret.
- **Number the requirements:** split prose into numbered, testable requirements, each with `<a id=""></a>`.
- **Acceptance criteria:** add Given/When/Then cases to each requirement.
- **Glossary terms:** check terms against the definitions (the `DEFN` prefix) and link or flag them.

**Reviewing**
- **Find gaps:** open a comment thread for each ambiguity, missing edge case or contradiction, without editing the text. See [Coding Agents in Comment Threads](/notes/agent-comments).
- **Check consistency:** compare a section with the sections that link to it, and with the baseline it changes.
- **Answer open threads:** work through the threads on a document, edit the sections, and reply with what changed.
- **Address review comments:** a follow-up prompt made from the comments on the changes of an earlier prompt (see Reviewing the Agent's Changes).

**Moving through a step**, as this repository does by hand today:
- **Draft the implementation plan** from a step's `requirements.md`.
- **Draft a test plan** from requirements, for testers.
- **Update the agent guide:** after a step, bring `CLAUDE.md` and `AGENTS.md` up to date with the new structure.
- **Fold into the baseline:** see the next section.
- **Hand off for implementation:** see the section after that.

<a id="NOTE-00117" data-uid="m8g71dz097zp"></a>
## Revising Baseline Specs from Change Specs

Step 008 set up the two kinds of folder: baseline specs describe the system as it is meant to be, and change specs describe the work for one task. In this repository, `documentation/work-items/step-NNN-*` are the change specs and `documentation/specifications/` is the baseline. Each step ends with hand edits that carry the change into the specifications. That is the "automated synchronization of parallel specs" in [Ideas](/notes/ideas).

The **Fold into baseline** recipe on a change document would work like this:

1. **Gather:** Specquer collects the change document, the baseline sections it links to, and the closest matches in the search index (`.specquer/cache/search.db`). The prompt gives these as a starting point, not as a limit.
2. **Plan first:** the agent lists the baseline sections it intends to change, add or remove, with one line each, and waits in its terminal for the user to confirm or correct the list. This step catches most mistakes cheaply.
3. **Edit:** the agent edits the baseline under the anchor rules:
   - keep anchors and move them with their headings;
   - write `<a id=""></a>` for new sections;
   - never change statuses.
4. **Trace:** each change is linked back. Either the agent writes a comment thread on the changed baseline section ("From WORK-00534"), or a later traceability feature records it ([Traceability Links](/notes/traceability-links)).
5. **Review and check:** see Reviewing the Agent's Changes. Specquer's checks run when the agent reports completion.

**When to offer it:** when a change document's sections reach their prefix's final status, the last in its list, Specquer makes a draft.

**Hard parts**
- **Finding every affected section:** a change rarely names all of them. The plan step and the consistency recipe partly cover this.
- **Partial completion:** some sections of a change may be done and others not. With `when: each-section`, the recipe folds only finished sections in, which needs status to be reliable.
- **Two changes touching the same baseline sections:** the second fold-in has to work from the result of the first. A queue that is worked through in order handles this, and so does Git if the two run on branches.
- **The baseline edited by hand in the meantime:** the agent has to merge rather than overwrite. Reading the current baseline at the start of the run covers most cases.

<a id="NOTE-00118" data-uid="o5j2g6r5jgda"></a>
## Handing a Completed Spec to Implementation

[Ideas](/notes/ideas) puts code generation out of scope: Specquer works beside coding agents. Handing a spec to an agent keeps that line. Specquer prepares and tracks the work, and the agent writes the code.

- **The package:** the change spec, the baseline sections it touches, their acceptance criteria and open threads, and `AGENTS.md`, as a prompt file. It goes with an instruction to plan first, implement on a branch or in a worktree, and report which section IDs it implemented and tested.
- **Statuses:** the agent's report can propose status changes, for example from `In Development` to `Peer Review` or `Testing`. Specquer shows them in the prompt's log for the user to apply. Agents never set statuses on their own, as the anchor rules already say.
- **Traceability into code:** the agent could put section IDs in commit messages and in comments next to the code (`Implements REQ-00012`). Specquer could later show which commits and files cite a section.
- **Long runs:** an implementation takes minutes to hours. The queue's log shows its progress, and the prompt stays in progress until the agent reports. A cloud agent is the other way to run long work (see below).
- **Unanswered questions:** a spec with open comment threads isn't ready. Specquer warns about them before **Send**.

<a id="NOTE-00136" data-uid="h6mj926fcxvv"></a>
## Reviewing the Agent's Changes

An agent in the user's terminal edits the user's working tree, unless the prompt asks it to work on a branch or in a worktree. Claude Code can create a worktree itself. Either way, the result is a set of changes to review. There are four options, and they combine.

<a id="NOTE-00137" data-uid="n2zptfgn0hj2"></a>
### A. Git Tools and Pull Requests Only

Specquer does nothing special. The user reviews with `git diff`, the IDE's diff view, a Git client, or a pull request on GitHub.

- **For:** nothing to build. The tools are mature, familiar and shared with code review. Pull requests add line comments, approvals and a record. This option works for teams that already review through pull requests.
- **Against:** line diffs know nothing about sections.
  - A section moved with its anchor shows as a deletion and an addition.
  - New anchors and renumbering add noise.
  - Reworded text inside long lines is hard to read.
  - There is no rendered view, and nothing ties a change to the prompt that made it.

<a id="NOTE-00138" data-uid="jlovrlndfytx"></a>
### B. A Read-Only Section View in Specquer

A **Changes** view compares the working tree, or a branch, with a base: `HEAD`, or the prompt's `baseCommit`. It shows the result by section, matched by UID:

- sections added, removed, moved, reworded, and status changed;
- for each, the rendered text before and after, with the changed words marked;
- the prompt and log entry that changed it, when there is one.

Accepting and rejecting stay with Git: commit, `git restore` a file, or ask the agent for a change.

- **For:** moves and rewordings read as what they are, and anchors don't add noise.
  - It answers "what did this prompt change?" directly.
  - It is useful without agents too, as "what changed since the last commit" for a reviewer.
  - The comparison by UID is a reuse of what reconciliation already does.
- **Against:** a new view to build: the tree of changes, rendered diffs of words, and choosing a base. Partial acceptance still means Git or a follow-up prompt.

<a id="NOTE-00139" data-uid="adtlgelpaif6"></a>
### C. Section Review with Accept and Reject

Option B, plus **Accept** and **Reject** for each section. A rejected section is put back as it was at the base.

- **For:** the finest control, and no Git needed for partial acceptance.
- **Against:** the hardest to get right.
  - **Sections depend on each other.** Rejecting a new section that an accepted one now links to leaves a broken link. Rejecting a move but accepting the moved text has no clear meaning.
  - **Anchors complicate it.** A rejected section's new anchor must be removed cleanly, and an accepted section's empty anchor still needs an ID.
  - **Specquer becomes a merge tool.** Changes made in the meantime have to be handled, and Git does this better.

<a id="NOTE-00140" data-uid="fuhrfpl9iqjq"></a>
### D. Review Through Comments and Follow-up Prompts

The reviewer comments on the changed sections, in Specquer's comment threads, from view B or the normal views. **Address review comments** then makes a follow-up prompt from those threads for the agent. The agent replies in each thread with what it changed, and the reviewer resolves them. This builds on [Coding Agents in Comment Threads](/notes/agent-comments).

- **For:** it matches how specs are reviewed between people, keeps the discussion next to the section, and turns "reject" into "change it this way", which is usually what a reviewer means.
- **Against:** a round trip per round of review, and it depends on the comment CLI.

<a id="NOTE-00141" data-uid="ukapljegdhqz"></a>
### Comparison

| | A. Git only | B. Section view | C. Accept and reject | D. Comments and follow-ups |
|---|---|---|---|---|
| Build effort | None | Moderate | High | Small, on top of the comment CLI |
| Understands sections (moves, anchors, statuses) | No | Yes | Yes | Yes |
| Rendered text | No | Yes | Yes | Yes, through the normal views |
| Partial acceptance | By hand, in Git | By hand, in Git | Yes | By asking for changes |
| Fits pull requests and teams | Best | Alongside them | Competes with them | Alongside them |
| Tied to the prompt and its log | No | Yes | Yes | Yes |
| Useful without agents | Yes | Yes | Somewhat | Yes |

**Suggested decision:**

1. Rely on A from the start.
2. Build B as the first piece of review in Specquer, since it is useful with and without agents.
3. Add D once the comment CLI exists.
4. Leave C until users ask for partial acceptance in Specquer often. Options B and D cover most of its value at a fraction of the risk.

What would change this: a team that reviews specs mostly outside pull requests would need B sooner. If agents often make mixed changes (some good, some not) that follow-ups don't fix, C would earn its cost.

<a id="NOTE-00142" data-uid="bdvnl9ukqhmg"></a>
## Handing Work to Cloud Agents Through GitHub

Several agents can work from a GitHub issue or pull request on hosted machines:

- **Claude Code:** Claude Code on the web works on a connected repository, and the Claude Code GitHub Action responds to `@claude` in issues and pull requests.
- **Codex:** Codex cloud works on connected repositories and responds to `@codex`.
- **GitHub Copilot:** its coding agent takes an issue assigned to it.

The details differ and change often, so the summary here is only of what is involved.

<a id="NOTE-00143" data-uid="qevxvyftxsji"></a>
### What Is Involved

1. **The repository must be on GitHub.**
   - **The work must be pushed.** The cloud agent sees only what is pushed: unsaved edits, uncommitted changes and local branches don't reach it, so Specquer would have to require (or offer) a commit and push of the material first.
   - **`.specquer/shared/` must be pushed too.** It holds the section data and the recipes, and is committed already.
2. **Each service must be set up once:**
   - an account and a subscription, or an API key, held by GitHub as a repository secret for the Action;
   - the service's GitHub app installed on the repository;
   - for some, an environment description (setup commands, allowed network access).

   This is all outside Specquer.
3. **Specquer creates the issue.**
   - **Body:** the prompt file's body becomes the issue's body, with the material linked at the pushed commit. Front matter that matters to the agent goes in as text.
   - **Calling GitHub:** Specquer would call the GitHub CLI (`gh issue create`) rather than hold a GitHub token itself, in the same spirit as leaving model keys with the agent.
   - **Addressing:** the issue is addressed to the agent by a mention, an assignee or a label, as the service expects.
4. **Tracking:** Specquer polls the issue and its linked pull request through `gh` and puts their states into the prompt's log: issue opened, agent started (a comment or a draft pull request), pull request ready, merged or closed. There is no claim step: the service decides when work starts.
5. **Results:** the agent opens a pull request on a branch. Review happens on GitHub (option A), or in Specquer by fetching the branch and comparing it with the base (option B). Comments go back as pull request comments, which the agent can respond to, rather than as Specquer threads, unless the sidecar changes are committed on the branch.
6. **Section IDs:**
   - **Assignment:** new sections arrive with empty anchors. Specquer assigns their IDs when the merged file is next saved, or a `specquer anchor` command in the Action could do it before merge.
   - **Parallel branches:** two branches can allocate the same ID. Section problems already report duplicate IDs, and renumbering fixes them.

<a id="NOTE-00144" data-uid="vfkovt54zmkn"></a>
### Fit with Local-First

- **Specquer works without it.** Nothing goes to GitHub unless the user picks this target for a prompt, and Specquer stays fully usable offline.
- **The specs leave the machine,** to GitHub and to the agent's vendor. For a repository already on GitHub that is mostly true already. But the issue's text is new and may hold excerpts, and in a public repository the issue is public.
- **The queue's model still holds.** The prompt is the same file, with GitHub as its consumer instead of the local agent. Its log comes from polling instead of the CLI.
- **The cost is a second integration** with its own failure modes: authentication through `gh`, rate limits, and services that change their triggers.

The verdict is that it fits as a later, opt-in target. Design the prompt file so it can become an issue body without change, and build the GitHub target only after the local queue is in use.

<a id="NOTE-00119" data-uid="k1jsmpmnzbfm"></a>
## Other Triggers

All of these make drafts, never pending prompts:

- **On a status change:** see Prefixes and Status Transitions.
- **On save:** cheap checks don't need an agent. The existing model runtime is enough for a quick lint, and an agent run per save would be too slow and too costly.
- **Scheduled:** a nightly consistency check that only opens comment threads. This would need the user's agent to be running, or a cloud agent.
- **In CI:** check on a pull request that its change specs and the baseline agree. This runs outside Specquer, using the same recipe through the agent's GitHub Action.

<a id="NOTE-00120" data-uid="ixg9riyuk52i"></a>
## Guardrails

- **A person sends every prompt.** Agent runs cost money and change files. Status changes and other events make drafts, never pending prompts.
- **The agent keeps its own permissions.** It runs in the user's terminal, with the user's settings, and Specquer never asks for permissions to be skipped. A recipe's `edit` scope is told to the agent in the prompt and checked afterwards, but enforced only by the agent's own permission settings. The prompt can recommend those settings.
- **Shared recipes are approved like shared models.** A recipe committed in `.specquer/shared/recipes/` can tell an agent anything, with the user's permissions. That is the same risk as a shared model endpoint (Step 013, H1), so it gets the same answer: each user approves a shared recipe, recorded by its hash in `.specquer/user/approvals.yaml`, and approves it again after it changes. A prompt records the hash of the recipe it came from.
- **Specs and comments are untrusted input.** Prompts are built from documents and threads that other people wrote. The draft step shows the user the whole prompt before it is sent.
- **Checks after every run:** section problems, damaged sidecars, and files changed outside the recipe's scope. A prompt that fails them is marked failed, whatever the agent reported.
- **Keys stay with the agent:** the agent uses the user's own login or subscription, and Specquer never holds the credentials. For GitHub, Specquer goes through `gh`.
- **The queue and logs are per user** (`.specquer/user/prompts/`) and not committed. Transcripts are linked to, not copied.

<a id="NOTE-00121" data-uid="msblkpey9617"></a>
## A Possible Order

1. **Recipes, copied:**
   - the recipe format, with prefixes and transitions;
   - drafts on status changes;
   - a menu that copies the filled-in prompt.

   This tests whether recipes are useful at all.
2. **The queue:** prompt files, the Prompts pane with editing, **Send** and the log, the `specquer prompts` commands, and the `/specquer-next` command exported for Claude Code and Codex.
3. **Picking up without typing in Claude Code:** the `Stop` hook and the background `--wait`, and hooks that add tool activity to the log.
4. **The section view of changes** (review option B), tied to each prompt.
5. **Fold into baseline,** with the plan step.
6. **Comments and follow-up prompts** (review option D), with the comment CLI.
7. **Hand off for implementation,** with status proposals and code traceability.
8. **GitHub as a target,** if wanted.

<a id="NOTE-00122" data-uid="algdojan7c5n"></a>
## Open Questions

1. How much of baseline synchronization can work without traceability links?
2. Should completed prompts and their logs ever be committed, as a record of which change spec produced which baseline edits? Or should that record live only in traceability links and commit messages?
3. Should a recipe be allowed to send its prompt without a draft, for trusted recipes such as **Find gaps** that only open comment threads?
4. With several agent sessions on one repository, should prompts be claimed by any session, or addressed to one ("the session working on Step 014")?
5. Should "waiting" prompts go back to the same session when answered, or to any session that picks the next prompt up?
6. Is the first status of a prefix always "not started" and the last always "done"? The `NOTE` prefix's `Archived` suggests that "final" sometimes means "set aside" rather than "done". Should a recipe be able to name a status other than `final`?
7. What does the Prompts pane show for a prompt claimed by a session that has since ended without reporting?
