<a id="NOTE-00105" data-uid="cnk1629zdyiq"></a>

<a id="NOTE-00106" data-uid="ow7ol57t1czk"></a>
# Specquer Driving Coding Agents

_Notes from October 2026, after Step 013. A brainstorm, not a design._

**Summary:** Specquer knows things a coding agent has to be told: the section in view, its ID, status and prefix, whether its folder holds baseline or change specs, its open comment threads, and what has changed since the last commit. Specquer could turn that knowledge into well-defined tasks it hands to the user's own agent (Claude Code, Codex and others). The task could be a named recipe run on a section, folding a finished change spec into the baseline, or handing a completed spec over for implementation. Specquer would still never generate text or code itself. There are several ways to start the agent. The simplest is copying a prompt, and the most capable is driving the agent through the Agent Client Protocol (ACP). The ideas below share four guardrails:

- a person starts every run;
- the agent works on a separate copy of the repository (a Git worktree);
- the person reviews the changes before they are merged;
- shared recipes need approval, as shared model endpoints do since Step 013's H1.

<a id="NOTE-00107" data-uid="bga6302t848b"></a>
## Why Specquer Would Start the Agent

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
## Ways to Start an Agent

<a id="NOTE-00109" data-uid="foiskuepultz"></a>
### 1. Copy a Prompt

Specquer fills in the recipe and puts the prompt on the clipboard, and the user pastes it into their running agent.

- No integration, and it works with every agent.
- The user stays in their usual tool, with its permissions and history.
- Specquer doesn't see the run, so it can only check the result when the files change.

This is a cheap way to try the recipe format before building anything else.

<a id="NOTE-00110" data-uid="uprf4dz8jy33"></a>
### 2. Open the Agent in a Terminal

Specquer opens a terminal running the agent with the prompt as its first message, for example `claude "<prompt>"`. The session is interactive, so the user can steer it, and it is the agent's normal user interface. Specquer still can't see progress. Opening a terminal also differs between operating systems.

<a id="NOTE-00111" data-uid="iyjs55s7mdew"></a>
### 3. Run the Agent Headless

Most agents have a non-interactive mode that Specquer could spawn (`Bun.spawn`) in the root folder or a worktree:

- `claude -p` with `--output-format stream-json`, `--allowedTools` and `--permission-mode`;
- `codex exec`, with JSON output;
- the Gemini, Copilot and Cursor command lines have similar print modes.

Specquer streams the run's progress into a pane, shows the edits as they land, and keeps a log. Each agent's flags and event format differ, so Specquer needs one adapter per agent. A headless run also can't ask the user for permission halfway through, so the allowed tools must be set in advance.

<a id="NOTE-00112" data-uid="hgsb8lb0u7ba"></a>
### 4. The Agent Client Protocol (ACP)

ACP is a JSON-RPC protocol over stdio, started by Zed, through which an editor drives an agent. Gemini CLI supports it natively, and adapters exist for Claude Code and Codex. If Specquer were an ACP client:

- one integration would cover several agents;
- the agent's permission requests ("may I edit this file?") would appear in Specquer, so a run could stay interactive without a terminal;
- Specquer could show the agent's plan and tool calls as they happen.

This is the most capable option and the most work. The protocol is young, so it should be checked for current support before choosing it.

<a id="NOTE-00113" data-uid="b0wg0lick913"></a>
### 5. Leave Work for the Agent to Pick Up

This is the reverse direction. Specquer records tasks, in files or behind an MCP server, and the user's agent pulls them when asked ("do the pending Specquer tasks"). It suits batch work and agents running in the cloud, and needs no process control. See [Coding Agents in Comment Threads](/notes/agent-comments) and [Agent-Delegated Summaries](/notes/agent-delegated-summaries).

<a id="NOTE-00114" data-uid="t4o13wmhh815"></a>
### Side by Side

| | Copy prompt | Terminal | Headless | ACP | Pick-up |
|---|---|---|---|---|---|
| Agents covered | All | Those with a CLI | One adapter each | Those with ACP support | Those with MCP or file access |
| Specquer sees the run | No | No | Yes | Yes | When the task is reported done |
| User can steer mid-run | Yes | Yes | No | Yes, through Specquer | Yes |
| Build effort | Least | Small | Moderate | Most | Moderate |

A sensible order is to go from left to right: copy a prompt first, then run one agent headless (probably Claude Code), then ACP if more agents are wanted.

<a id="NOTE-00115" data-uid="qs10h368pmie"></a>
## Recipes: Predefined Prompts

A recipe is a named, repeatable task, defined by:

- **a scope:** a section, a document, a folder or the selected text;
- **where it applies:** folder types, prefixes or statuses, for example only `CHANGE` sections that are `Complete`;
- **a prompt template** with fields Specquer fills in: `{{section.id}}`, `{{section.markdown}}`, `{{file}}`, `{{threads}}`, `{{links}}`, `{{changedFiles}}`, `{{allowedStatuses}}`;
- **what the agent may touch:** files (this document only, the baseline folder, comments only) and tools (read and edit only, or shell too);
- **the expected result:** edits, comment threads, a report, or a new document;
- **checks after the run:** no section problems, no files changed outside the allowed scope, sidecars still valid.

Recipes could be Markdown files with front matter: shared ones in `.specquer/shared/recipes/`, committed, and personal ones in `.specquer/user/recipes/`. Specquer could also export them as the agents' own commands and skills: Claude Code's `.claude/commands/` and `.claude/skills/`, and Codex's custom prompts. That way the same recipe works whether it is started from Specquer or typed in the agent.

The recipes would be offered:

- in the section badge's menu (**Run recipe…**);
- on the file tree;
- in a command palette.

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
- **Review the changes:** summarize what changed since the last commit, section by section, for a reviewer.

**Moving through a step**, as this repository does by hand today:
- **Draft the implementation plan** from a step's `requirements.md`.
- **Draft a test plan** from requirements, for testers.
- **Update the agent guide:** after a step, bring `CLAUDE.md` and `AGENTS.md` up to date with the new structure.
- **Fold into the baseline:** see the next section.
- **Hand off for implementation:** see the section after that.

<a id="NOTE-00117" data-uid="m8g71dz097zp"></a>
## Revising Baseline Specs from Change Specs

Step 008 set up the two kinds of folder: baseline specs describe the system as it is meant to be, and change specs describe the work for one task. In this repository, `documentation/work-items/step-NNN-*` are the change specs and `documentation/specifications/` is the baseline. Each step ends with hand edits that carry the change into the specifications. That is the "automated synchronization of parallel specs" in [Ideas](/notes/ideas).

A **Fold into baseline** recipe on a change document would work like this:

1. **Gather:** Specquer collects the change document, the baseline sections it links to, and the closest matches in the search index (`.specquer/cache/search.db`). The agent gets these as a starting point, not as a limit.
2. **Plan first:** the agent lists the baseline sections it intends to change, add or remove, with one line each. The user confirms or corrects the list. This step catches most mistakes cheaply.
3. **Edit:** the agent edits the baseline in a worktree under the anchor rules:
   - keep anchors and move them with their headings;
   - write `<a id=""></a>` for new sections;
   - never change statuses.
4. **Trace:** each change is linked back. Either the agent writes a comment thread on the changed baseline section ("From WORK-00534"), or a later traceability feature records it ([Traceability Links](/notes/traceability-links)).
5. **Review:** Specquer shows the diff section by section, using its section extents, rather than as raw lines. The user accepts or rejects each section.
6. **Check and merge:** Specquer runs the section checks on the worktree and then merges the accepted changes.

**When to offer it:** when a change document's sections all reach a final status (`Complete`, or what the prefix configures), Specquer suggests the recipe. It never runs it on its own.

**Hard parts**
- **Finding every affected section:** a change rarely names all of them. The plan step and the consistency recipe partly cover this.
- **Partial completion:** some sections of a change may be done and others not. The recipe would fold only finished sections in, which needs status to be reliable.
- **Two changes touching the same baseline sections:** the second fold-in has to work from the result of the first. Worktrees make this a merge conflict, which Git and the review step can handle.
- **The baseline edited by hand in the meantime:** the agent has to merge rather than overwrite. Reading the current baseline at the start of the run covers most cases.

<a id="NOTE-00118" data-uid="o5j2g6r5jgda"></a>
## Handing a Completed Spec to Implementation

[Ideas](/notes/ideas) puts code generation out of scope: Specquer works beside coding agents. Handing a spec to an agent keeps that line. Specquer prepares and tracks the work, and the agent writes the code.

- **The package:** the change spec, the baseline sections it touches, their acceptance criteria and open threads, and `AGENTS.md`. It goes with an instruction to plan first, implement in a worktree or branch, and report which section IDs it implemented and tested.
- **Statuses:** the agent's report could move sections from `In Development` to `Peer Review` or `Testing`. Specquer would propose each change and the user would confirm it. Agents never set statuses on their own, as the anchor rules already say.
- **Traceability into code:** the agent could put section IDs in commit messages and in comments next to the code (`Implements REQ-00012`). Specquer could later show which commits and files cite a section.
- **Long runs:** an implementation takes minutes to hours, so the run would continue in the background with a notification when it finishes. An alternative is to open a GitHub issue or task containing the package, for a cloud agent such as Claude Code on the web or Codex cloud, and track the pull request that results.
- **Unanswered questions:** a spec with open comment threads isn't ready. Specquer should warn about them before handing it over.

<a id="NOTE-00119" data-uid="k1jsmpmnzbfm"></a>
## Other Triggers

These are best treated as suggestions the user confirms, never as automatic runs:

- **On a status change:** a section reaches `Complete` → suggest **Fold into baseline**; `Approved` → suggest **Hand off for implementation**.
- **On save:** cheap checks don't need an agent. The existing model runtime is enough for a quick lint, and an agent run per save would be too slow and too costly.
- **Scheduled:** a nightly consistency check that only opens comment threads.
- **In CI:** check on a pull request that its change specs and the baseline agree. This runs outside Specquer, using the same recipe through the agent's CLI.

<a id="NOTE-00120" data-uid="ixg9riyuk52i"></a>
## Guardrails

- **A person starts every run.** Agent runs cost money and change files. Events and statuses can suggest a run, never start one.
- **Worktrees:** the agent works in its own worktree (`git worktree add`), so the user's open editors and unsaved edits aren't touched. Specquer's saves already refuse to overwrite a changed file, but conflicts in the middle of a run would still be confusing.
- **Shared recipes are approved like shared models.** A recipe committed in `.specquer/shared/recipes/` can tell an agent anything, with the user's permissions. That is the same risk as a shared model endpoint (Step 013, H1), so it gets the same answer: each user approves a shared recipe, recorded by its hash in `.specquer/user/approvals.yaml`, and approves it again after it changes.
- **Specs and comments are untrusted input.** Prompts are built from documents and threads other people wrote. A recipe limits what the agent may touch through the agent's own permission settings (allowed tools and folders), not only through the prompt. Specquer never passes flags that skip permissions.
- **Checks after every run:** section problems, damaged sidecars, and files changed outside the recipe's scope. A run that fails them is shown as failed, and its changes are not merged.
- **Keys stay with the agent:** the agent uses the user's own login or subscription, and Specquer never holds the credentials.
- **Logs:** each run's prompt, events and result are kept in `.specquer/user/runs/`, which is per user and not committed.

<a id="NOTE-00121" data-uid="msblkpey9617"></a>
## A Possible Order

1. **Recipes, copied:** the recipe format, the fields, and a menu that copies the filled-in prompt. This tests whether recipes are useful at all.
2. **Exported recipes:** write recipes as Claude Code commands and skills, and as Codex prompts, so they also run from the agent.
3. **Headless runs for one agent:** in a worktree, with progress in a pane, the checks after the run, and the review by section.
4. **Fold into baseline,** with the plan step and the suggestion on a status change.
5. **ACP,** for other agents and for permission requests shown in Specquer.
6. **Hand off for implementation,** with status proposals and code traceability.

<a id="NOTE-00122" data-uid="algdojan7c5n"></a>
## Open Questions

1. Is a headless run worth building, or do users prefer to stay in their agent's own interface and use exported recipes?
2. Where do recipes live, if not in `.specquer/shared/`? Would one file per recipe in the agents' own formats be enough?
3. Should the review step work by section within Specquer, or leave review to Git tools and pull requests?
4. How much of baseline synchronization can work without traceability links?
5. Which statuses count as "final" for a change spec? Per prefix, in `prefix.config.yaml`?
6. Does handing work to cloud agents through GitHub fit Specquer's local-first model?
