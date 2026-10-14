<a id="NOTE-00067" data-uid="mxuar62zlm7b"></a>

<a id="NOTE-00068" data-uid="ae3ymazzaxyf"></a>
# Specquer, Kiro and Spec Kit

_Notes from October 2026, after Step 010. Kiro's and Spec Kit's details are from their documentation at that time (see [Sources](#sources)); both change quickly._

**Summary:** all three keep Markdown specs in the repository, next to the code, and use a model with them. They answer different questions. Kiro is an agentic IDE and Spec Kit is a toolkit of prompts and templates for the coding agent a team already uses; in both, a spec is the plan for one feature or bug fix, which the agent writes with the user and then implements. Specquer is a spec editor and browser: the specs are the system's lasting description, with permanent section IDs, summaries and a chat that cites them, and writing the code is left to the team's coding agent. Kiro and Spec Kit compete with each other; Specquer can sit beside either.

<a id="NOTE-00069" data-uid="eclwg0cmrizd"></a>
## Kiro in Brief

- **What it is:** an agentic IDE from AWS, built on Code OSS (the open-source base of VS Code), announced in July 2025. It also comes as a CLI and a web interface, and its models run on Amazon Bedrock.
- **Specs:** one folder per feature under `.kiro/specs/` (for example `.kiro/specs/user-authentication/`), each with three files:
  - `requirements.md`: user stories with acceptance criteria in EARS notation ("WHEN [condition] THE SYSTEM SHALL [behavior]"), or `bugfix.md` for a bug fix (current, expected and unchanged behavior);
  - `design.md`: architecture, sequence diagrams, error handling and the testing strategy;
  - `tasks.md`: implementation tasks whose status Kiro updates as it works.
- **Workflow:** requirements, then design, then tasks, with the user approving each before the next. Design-first and a one-pass "Quick Spec" are alternatives. Kiro runs the tasks one at a time or all together, in waves of independent tasks.
- **Keeping specs current:** the user edits a file or asks Kiro to; Kiro brings the others into line on request. **Sync Files** on `tasks.md` adds tasks for new requirements and marks tasks already done. **Analyze Requirements** looks for inconsistencies, ambiguities and gaps. The docs call specs "designed for continuous refinement", but one spec is meant for one feature, not the whole codebase.
- **Steering:** Markdown in `.kiro/steering/` (`product.md`, `tech.md`, `structure.md` by default, with front matter to include a file always, for matching files, on request or when its description fits) and in `~/.kiro/steering/`. Kiro also reads `AGENTS.md` files.
- **Hooks and tools:** hooks in `.kiro/hooks/` run a shell command or a prompt on events such as a file save or a tool call. MCP servers add tools.
- **Cost and data:** a free tier with 50 credits a month, paid plans from $20 to $200 per user a month, and many models (Claude, GPT and open-weight ones). For individual users, content may be used for service improvement, including model training, unless they opt out; enterprise content isn't.

<a id="NOTE-00070" data-uid="obqwcw9igl1z"></a>
## Spec Kit in Brief

- **What it is:** an open-source toolkit from GitHub (MIT license): the `specify` CLI (Python, installed with `uv`) and a set of commands, templates and scripts it installs into a project for the coding agent the team chooses. It supports 38 agents, among them Copilot, Claude, Gemini, Codex and Kiro, plus a generic one. It has no editor or model of its own; the agent does the work.
- **Process:** `specify init` sets the project up. The constitution (`/speckit-constitution`, once per project) holds the principles later steps are checked against. Then, per feature: `/speckit-specify` (the feature's `spec.md`, what and why), `/speckit-plan` (`plan.md` and the design artifacts), `/speckit-tasks` (a dependency-ordered `tasks.md`), `/speckit-implement`, and `/speckit-converge`, which compares the code with the spec, plan and tasks and adds tasks for the gaps until it reports the feature converged.
- **Quality gates, optional:** `/speckit-clarify` asks about underspecified areas and folds the answers into the spec; `/speckit-checklist` writes requirement-quality checklists for a reviewer; `/speckit-analyze` reports conflicts, gaps and ambiguities across the spec, plan and tasks without changing them.
- **Layout:** a numbered directory per feature (`001-feature-name`), with the project's own files in `.specify/` (the constitution under `.specify/memory/`). The active feature is the one in `.specify/feature.json`, not the Git branch; numbered feature branches come from an opt-in Git extension.
- **Other processes:** extensions add bug fixing (assess, fix, verify, in `.specify/bugs/`) and idea assessment (from intake to a go, needs-clarification or kill decision, in `.specify/assessments/`). Presets, workflows and bundles adapt the templates and commands.
- **Existing systems:** Spec Kit doesn't infer specs for existing behavior; the first spec in an existing codebase describes one change. For finished features, the team picks a persistence model: **flow-forward** (each feature directory stays as a record, and new requirements get a new one), **living spec** (`spec.md` stays the contract and the rest is regenerated), or **flow-back** (any artifact can change and the team reconciles them, at the risk of "silent divergence"). None of them is a specification of the whole system; the constitution is the only project-wide document.
- **Cost and data:** free. Prompts and code go wherever the chosen agent sends them.

<a id="NOTE-00071" data-uid="ec4rutznqi68"></a>
## Specquer in Brief

- **What it is:** a local editor and browser for a folder of Markdown files. It's a single executable that serves a browser UI on `localhost`, one instance per root folder.
- **Specs:** any Markdown, in any structure. A folder's type (`BASELINE`, `CHANGE`, `AUXILIARY` or `NONSECTIONED`) and prefix say how its sections are treated. Sections in sectioned folders get permanent IDs (`<a id="SPEC-00012" data-uid="…">`) that survive edits, moves and renames, so links and traceability can depend on them.
- **AI:** read-only. Summaries at any depth, with the preview's slider, cached by text and model. A document chat answers from the specs found by full-text search and cites the sections it used. It never edits a file.
- **Model and data:** one model, configured in `.specquer/shared/agent.config.yaml` with the user's own API key (NVIDIA's API catalog today). Without a key, nothing leaves the machine. There are no accounts, credits or telemetry.
- **Agents:** coding agents aren't part of Specquer. It writes the section rules to `AGENTS.md` on request, so an agent that edits the specs keeps the anchors intact.

<a id="NOTE-00072" data-uid="eqgr7otjo3b4"></a>
## Side by Side

| | Kiro | Spec Kit | Specquer |
| --- | --- | --- | --- |
| Kind of tool | Agentic IDE, CLI and web | Commands and templates for an agent | Spec editor and browser |
| Main job | Plan a change, then write its code | Plan a change, then have the agent write it | Write, read and navigate the specs |
| Unit of spec | A feature or bug fix: requirements, design, tasks | A feature: spec, plan, design artifacts, tasks | Any Markdown file; sections within it |
| Life of a spec | Created with a feature; refined while it is built | Per feature, kept by a chosen persistence model | Lasts as long as the system; changes are folders of their own (`CHANGE`) |
| Project-wide context | Steering files | The constitution | The baseline specs themselves |
| Identity | Numbered requirements and tasks, per spec | Numbered features; items within a spec | Permanent section IDs across the repository |
| Checking specs | Analyze Requirements | Clarify, checklists, analyze, converge | Section problems (anchors, IDs); no model checks yet |
| Who writes | Kiro's agent, with the user approving | The team's agent, step by step | The user, or an agent of their choice following `AGENTS.md` |
| AI | Its own, many models; writes specs and code | The team's agent | Summaries and cited answers; one model |
| Where it runs | Desktop and Kiro's cloud | Wherever the agent runs | The user's machine; the model's provider only |
| Account and cost | Sign-in; credits from free to $200 a month | Free; the agent's costs | None; the model provider's charges |

<a id="NOTE-00073" data-uid="fcuvnyolneoz"></a>
## What They Share

- **Specs as Markdown in Git:** all three keep specs as files reviewed and merged like code, not in a separate tool.
- **Context for agents:** Kiro's steering files, Spec Kit's constitution and Specquer's `AGENTS.md` all tell an agent how to work in the project. Kiro reads `AGENTS.md` too, and most agents Spec Kit supports do.
- **Requirements, then a plan:** Specquer's own work items (`documentation/work-items/step-0NN-…/` with `requirements.md` and `implementation-plan.md`) follow the same order as a Kiro spec or a Spec Kit feature. They are written by hand with a coding agent, approved step by step, and keep an implementation status as `tasks.md` does. The plans' "Implementation Status" sections, recording what differed from the plan, do by hand what Spec Kit's converge and Kiro's Sync Files do with a model.

<a id="NOTE-00074" data-uid="go4j1tycodvs"></a>
## Where They Differ

- **The lasting description:** neither Kiro nor Spec Kit has a place for the whole system's specification. Their specs describe changes; Kiro's steering and Spec Kit's constitution hold principles and a short summary, not behavior. Spec Kit says so plainly: its first spec in an existing codebase "defines the change you intend to make, not a retroactive specification of every existing behavior". Specquer's baseline specs are that description, and a change folder holds what is about to change. After a few dozen features, knowing how the system behaves today means reading their specs in order, unless the team keeps living specs and merges them by hand.
- **Identity and traceability:** a Kiro requirement or a Spec Kit item is known by its place in one feature's files, and neither documents identifiers that last beyond it. A Specquer section keeps its ID through edits, moves and renames, across the repository, which [traceability links](/notes/traceability-links) build on.
- **Checking with a model:** Kiro and Spec Kit both check specs for ambiguity, conflicts and gaps, and compare code with specs. Specquer checks structure (anchors, IDs, conflict markers), not content.
- **Reading at scale:** Specquer is built for reading many specs: the tree, the preview, summaries at any depth, and a chat that cites sections. Kiro and Spec Kit give the agent a feature's files as context but have no summaries or browsing of their own beyond an editor.
- **Who acts:** Kiro's agent and the agent Spec Kit drives write files and run commands with the user's approval. Specquer's AI only reads, and writing is left to the user and their agent.
- **Lock-in:** Kiro ties the process to its IDE and account. Spec Kit is agent-neutral but prescribes the process and file set. Specquer prescribes neither the process nor the agent, only the anchors.
- **Privacy and cost:** Kiro needs an account and credits, and sends content to AWS, used for service improvement unless an individual opts out. Spec Kit sends whatever the chosen agent sends. Specquer needs only a key for the model the team chooses, and sends nothing without one.

<a id="NOTE-00075" data-uid="sd68kxlwhloy"></a>
## Using Them Together

A team could use Kiro or Spec Kit to build features and Specquer to keep the lasting specs:

- **Their specs in Specquer:** both write Markdown, so Specquer can show it. Spec Kit's feature directories could be a `CHANGE` or `AUXILIARY` folder; Kiro's `.kiro/specs/` probably `AUXILIARY` or `NONSECTIONED`, though whether the tree shows a folder whose name starts with a dot needs checking. In a sectioned folder, Specquer would add anchors to their files, which their agents should then leave alone (the `AGENTS.md` rules cover that).
- **Specquer's specs for their agents:** a Kiro steering file or Spec Kit's constitution can point the agent at the baseline specs, so a new feature's spec starts from them, cited by section ID.
- **Closing a change:** when a feature is done, what it changed belongs in the baseline specs. That's by hand in all three today; Spec Kit's "living spec" model comes closest, but per feature.

<a id="NOTE-00076" data-uid="bryj3k4kx7mg"></a>
## Ideas for Specquer

From Kiro and Spec Kit, worth considering later (added to [Ideas](/notes/ideas) only if one is taken up):

- **Requirement checks:** like Kiro's Analyze Requirements and Spec Kit's analyze: a model pass over a section and its children looking for ambiguity, conflicts and gaps, reported with citations as the chat does. It would read only, like the rest of Specquer's AI.
- **Clarifying questions:** like Spec Kit's clarify, the chat could ask about the underspecified parts of a section. Writing the answers in would stay with the user.
- **Merging a change:** help folding a finished `CHANGE` folder into the baseline, the step none of the three tools does, with section IDs to say which sections it touches.
- **EARS as a style:** a template or a lint for requirements written as "WHEN … THE SYSTEM SHALL …", for teams that want it. It shouldn't be required.
- **Task status:** a view of the open tasks in change folders, where Kiro tracks `tasks.md`.
- **Hooks:** commands run on save, such as a lint or link check. These would run code on the user's machine, so they need the same care as anything that writes files.

<a id="NOTE-00077" data-uid="avd6565364cy"></a>
## Sources

- [Kiro: Specs](https://kiro.dev/docs/specs/), [Feature Specs](https://kiro.dev/docs/specs/feature-specs/) and [Best Practices](https://kiro.dev/docs/specs/best-practices/)
- [Kiro: Steering](https://kiro.dev/docs/steering/) and [Hooks](https://kiro.dev/docs/hooks/)
- [Kiro: Pricing](https://kiro.dev/pricing/) and [Data Protection](https://kiro.dev/docs/privacy-and-security/data-protection/)
- [Introducing Kiro](https://kiro.dev/blog/introducing-kiro/) (July 2025)
- [Spec Kit on GitHub](https://github.com/github/spec-kit) and [its documentation](https://github.github.io/spec-kit/): the [quick start](https://github.github.io/spec-kit/quickstart.html), [existing projects](https://github.github.io/spec-kit/guides/existing-projects.html) and [spec persistence models](https://github.github.io/spec-kit/concepts/spec-persistence.html)
