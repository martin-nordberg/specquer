<a id="NOTE-00088" data-uid="t54obued62nj"></a>

<a id="NOTE-00089" data-uid="lrlnpnqykbau"></a>
# Coding Agents in Comment Threads

_Notes from October 2026, after Step 013._

**Summary:** coding agents could take part in a section's comment threads, both raising questions and answering them. Comments are a better place than chat for a question the agent can't settle itself. A thread stays next to the section it is about, survives the session, and can be answered later by whoever knows the answer. There are five ways to let agents in: rules in `AGENTS.md` that describe the sidecar, so agents edit it directly; a skill; a `specquer comment` command; an MCP server; or Specquer's own web API. Editing the sidecar directly is the cheapest to build, but it is the one most likely to go wrong, because agents would have to make up UIDs, times and section UIDs and write valid YAML. The proposal is to make a command (CLI) the core, built on `CommentService`, and to have one rule in `AGENTS.md` point to it. A skill can carry the workflow on top of that, and an MCP server can wrap the same functions later if users ask for one. This takes up question 3 of [Ideas](/notes/ideas), "Coding agents as users".

<a id="NOTE-00090" data-uid="ve6752ywy8t2"></a>
## What an Agent Would Need

Step 012 keeps a document's threads in `<name>.md.comments.yaml` beside it (`shared/src/comments/comments.ts`). Each thread has:

- a `threadUid` and the `sectionUid` it belongs to;
- a `status` (`Open` or `Resolved`), and who changed it and when;
- one or more comments, each with a `commentUid`, `createdBy`, `createdAt` (UTC, quoted) and Markdown `text`.

To add a comment by hand, an agent has to:

1. Find the section's `data-uid` in the anchor before the heading. That is not the `id` a person would mention, such as `REQ-00012`.
2. Make up a new thread UID and comment UID in the UID format, unused anywhere in the file.
3. Write the current UTC time in Specquer's format.
4. Write YAML that passes `checkSidecar`. If it doesn't pass, the whole sidecar becomes unusable, and Specquer shows none of the document's threads until it is fixed.
5. Leave any comment it didn't write unchanged.

The running server copes with edits made outside it. `CommentService` applies each change to the sidecar as it is on disk, and the client reads the threads again when its window gets the focus. So on the Specquer side, nothing stops an agent from writing the file. The difficulty is in the five steps above.

The API already offers what an agent needs, as typed changes on `PATCH /api/comments` (`add-thread`, `reply`, `edit`, `set-status`, `delete-comment`, `delete-thread`). The server issues the UIDs and times, and it refuses an edit to a comment that changed in the meantime. But the API is only for the browser: the session token is in the URL in `.specquer/user/instance.json` (mode `0600`), and the API answers only while Specquer runs.

<a id="NOTE-00091" data-uid="ggve7lzw5pae"></a>
## Five Ways In

<a id="NOTE-00092" data-uid="d74rgmp8bpus"></a>
### 1. Rules in `AGENTS.md`

Extend the agent guide (`shared/src/sections/agent-guide.ts`) with the sidecar format and how to add a thread or reply.

- **Discovery:** good. The agent sees the rules in every session: Codex, Cursor, Copilot and others read `AGENTS.md`, and Claude Code reads `CLAUDE.md`, which can import it.
- **Reliability:** the weakest of the five, for the reasons in the list above.
  - It conflicts with the existing rule "Never edit, copy or invent an `id` or a `data-uid`". Agents would need a separate, narrower permission to make up comment UIDs.
  - Agents also misjudge the time, or write a local time.
  - One bad indent hides every thread in the document.
- **Cost:** the rules cost context in every session, including the many sessions that never touch comments.
- **Works without Specquer running:** yes.
- **Build effort:** a paragraph. Checking an agent's edits is already done by `checkSidecar`, and the problems are shown with the section problems.

<a id="NOTE-00093" data-uid="wqfbf1lvk6xk"></a>
### 2. A Skill

A skill (`SKILL.md` with instructions, and optionally scripts) that the agent loads when a task matches its description: "comment on a spec section", "answer open questions in the specs".

- **Discovery:** decent when the user's words match the description, and weaker when they don't. A skill is loaded on demand, so it costs little context until it is used. Claude Code supports skills, and other agents have started to read the same format, but support is less even than for `AGENTS.md` or MCP.
- **Reliability:** about the same as rules if the skill only describes the YAML, and as good as a CLI if it bundles a script that does the writing. In the second case the skill is really a CLI plus instructions.
- **Where it shines:** workflows rather than mechanics. Examples: "read the open threads on the sections you are about to change", "ask instead of guessing", "say what you changed when you answer", "don't resolve a thread a person opened".
- **Build effort:** small. Specquer could write it the way it writes `AGENTS.md` today, on request.

<a id="NOTE-00094" data-uid="dfp6v4xcn47k"></a>
### 3. A Command Line

Subcommands of the `specquer` executable, for example:

```
specquer comments <file> [--open] [--section REQ-00012] [--json]
specquer comment add <file> <section ID> --text "…"   (prints the new thread's UID)
specquer comment reply <file> <thread UID> --text "…"
specquer comment resolve <file> <thread UID>
```

- **Discovery:** agents use shells all day and read `--help` well. One line in `AGENTS.md` is enough to make them aware of it: "To comment on a spec section, use `specquer comment --help`; don't edit `.comments.yaml` files."
- **Reliability:** high.
  - Sections are named by the IDs people use, such as `REQ-00012`, and the command finds the UID. A duplicated ID is reported, not guessed.
  - UIDs, times and the author's name come from Specquer.
  - A refused change gets a clear message and a non-zero exit code.
- **Works without Specquer running:** it can. When an instance serves the root folder, the command sends the change to it, using the URL and token in `instance.json`, so the change goes through the same write queue. Otherwise it applies `CommentService` to the files itself.
- **Cost:** no context until the agent uses it. The output is plain text, or JSON with `--json`.
- **Build effort:** moderate. The command line needs subcommands, it shares `CommentService` and the section lookup, and it needs tests. The executable has to be on the `PATH`.

<a id="NOTE-00095" data-uid="z34slwzvtc8e"></a>
### 4. An MCP Server

`specquer mcp` speaks MCP over stdio. The agent starts it from its configuration, for example a committed `.mcp.json`, and gets tools such as `list_threads`, `add_thread`, `reply` and `set_status`.

- **Discovery:** good once the server is configured. The tools and their schemas are listed to the agent, and the descriptions say when to use them. Configuring it is a step each user, or the repository, has to take, and it is set up differently for each agent.
- **Reliability:** as good as the CLI, with typed inputs and structured results.
- **Cost:** the tool descriptions take context in every session. Agents that defer tools reduce this cost.
- **Security:** stdio avoids opening another port. Over HTTP, the server would need the same token rules as the API ([Security](/specifications/security)).
- **Build effort:** the most of the five: the MCP SDK as a dependency, the protocol's lifecycle, and testing against more than one agent. It does fit other agent work. [Agent-Delegated Summaries](/notes/agent-delegated-summaries) also proposes an MCP server, so one server could hold both.

<a id="NOTE-00096" data-uid="h3a4gthxk15s"></a>
### 5. The Web API

Let agents call Specquer's own HTTP API. Most of this exists already:

- `GET /api/comments?path=…` and `PATCH /api/comments` cover every change to a thread.
- The server accepts `Authorization: Bearer <token>`, and was planned for "a future desktop shell or coding agent" ([Security](/specifications/security) §3).
- A request with a bearer token doesn't need an `Origin` header (§4).
- An agent can find the URL and token in `.specquer/user/instance.json` and use `curl`.

What it costs:

- **Discovery:** good with a rule in `AGENTS.md` that points to the instance file and the routes. Agents use `curl` and JSON easily.
- **Reliability:** high for what the server does: UIDs, times and the author come from Specquer, and stale edits are refused. Two weak spots remain:
  - The API takes section UIDs (`add-thread` has a `sectionUid`), so the agent still has to look up the UID. A route that takes the section's ID would fix this.
  - Multi-line Markdown inside JSON inside a shell command is a common quoting failure. Agents often get around it by writing a temporary file first.
- **Works without Specquer running:** no. The agent finds out from a missing instance file or a refused connection, and then has nothing to fall back on.
- **Security:** the most to think about of the five.
  - The session token opens the whole API: files, settings, and `POST /api/settings/agent/approve`. An agent that can read `instance.json` could approve a shared model endpoint, which undoes H1.
  - The token also ends up in the agent's conversation, and so with its model provider. It works only on this machine and only until the server restarts, so the exposure is small, but it is real.
  - A token limited to the comment routes would remove both concerns. The server would issue it to agents, for example in a second, agent-specific instance file.
- **Stability:** the API is now internal between the client and the server, and its shapes change with the client. Agents need a documented subset that stays stable, with versions.
- **Build effort:** small for an unofficial use, which is just a rule pointing to the existing routes. Moderate for a proper one: a scoped token, routes that take section IDs, error messages written for agents, and documentation.

Seen this way, the web API isn't a rival to the CLI and the MCP server: it is the transport both of them would use while Specquer is running. Giving agents the API directly skips the wrapper. It is cheaper to build, but every agent then has to handle the token and the quoting itself.

<a id="NOTE-00097" data-uid="x0fg3rwlyn65"></a>
### Side by Side

| | `AGENTS.md` rules | Skill | CLI | MCP server | Web API |
|---|---|---|---|---|---|
| Agent finds it | Always | When the task matches | With one rule in `AGENTS.md` | Once configured | With one rule in `AGENTS.md` |
| Context cost | Every session | When used | When used | Every session (tool list) | When used |
| Correct UIDs, times, section UIDs | Up to the agent | Up to the agent, or a script | Specquer | Specquer | Specquer, but the agent looks up the section's UID |
| Damaged sidecar | Possible | Possible | No | No | No |
| Works across agents | Widest | Narrower | Any agent with a shell | Most current agents | Any agent with a shell |
| Needs Specquer running | No | No | No | No (stdio) | Yes |
| Token in the agent's context | No | No | No | No | Yes |
| Build effort | Least | Small | Moderate | Most | Small unofficially, moderate as a supported API |

<a id="NOTE-00098" data-uid="ey5fl9cirg84"></a>
### Recommendation

1. **Build the CLI first,** on an agent-facing subset of the web API. The subset takes section IDs, uses a token limited to comments, and is versioned. The CLI uses it when Specquer is running and writes through `CommentService` when it isn't. This gives the reliability of the API without putting a token or JSON quoting in the agent's hands. It works with any agent that has a shell, costs no context until it is used, and also helps people who script. Documenting the subset for direct use can come later, at little cost.
2. **Have one rule in the guide point to it.** Specquer writes the guide to `AGENTS.md` already. The rule also says not to edit sidecars by hand, apart from moving, renaming or deleting them with their documents, which is the existing rule.
3. **Offer a skill for the workflow:** when to ask and how to answer (see the next section). Specquer writes it on request. Don't let the skill describe the YAML.
4. **Add MCP later**, as a thin layer over the same functions, if users ask for it or the summary work in [Agent-Delegated Summaries](/notes/agent-delegated-summaries) needs it.

<a id="NOTE-00099" data-uid="hdvkoxjztk2z"></a>
## Will Agents Work It Out on Their Own?

These are estimates from how current coding agents behave. Nothing here has been measured.

- **No instructions, no sidecars in the repository:** very unlikely. Nothing tells the agent that comments exist. Asked to "leave a comment on the login section", it would most likely add a Markdown or HTML comment to the document, or reply in its chat.
- **No instructions, sidecars present:** an agent asked to comment might find the `.comments.yaml` files and copy their shape. It would often get the YAML right, and often get the details wrong:
  - a `sectionUid` copied from the wrong anchor, or the section's `id` put in its place;
  - UIDs that are too long, upper case or reused;
  - a local time, or an unquoted one;
  - an existing comment reformatted.

  `checkSidecar` would catch most of these, but at the cost of hiding the document's threads until someone fixes the file.
- **With rules that describe the format:** mostly correct YAML. The section UID and new UIDs remain the usual mistakes. The rules have to grant a narrow exception to "never invent a `data-uid`", which muddies a rule that matters more.
- **With a CLI and one rule:** very likely to work. Agents run unfamiliar commands well once they know the command exists and has `--help`. The usual failure is not thinking of it at all, which the rule handles.
- **Deciding when to comment** is harder than how. Without guidance, agents tend either to settle questions silently in the text or to ask in chat. Asking in a thread takes an explicit instruction, which is what the skill is for.

A small evaluation would replace these estimates: a fixture repository with sidecars, a few prompts ("comment on REQ-00012", "write this spec and raise anything you are unsure of", "answer the open threads") and two or three agents, scored with `checkSidecar` and by reading the threads. Run it before the CLI is built and after.

<a id="NOTE-00100" data-uid="dehy53f70kcz"></a>
## Questions in Both Directions

<a id="NOTE-00101" data-uid="toveypbwhl4x"></a>
### An Agent Asks, a Person Answers

An agent writing or changing a spec often meets a choice it can't settle: which roles may do something, a limit, behavior in an edge case. Today it guesses, writes "TBD", or asks in a chat that is gone once the session ends. A thread on the section keeps the question where the answer is needed.

- **Raising:** the agent writes its best guess into the section, marked as a guess, and opens a thread. The thread states the question, the options it saw and which one it chose for now. Specquer shows the pip and the open count, so nothing else is needed for the question to be seen.
- **Answering:** a person replies in Specquer. Answering doesn't resolve the thread.
- **Picking up:** in a later session, the agent is asked to "work through the answered questions". `specquer comments --open --json` shows the threads whose last comment isn't the agent's. The agent changes the section, replies with what it changed, and leaves the thread open for the person to resolve.
- **Who resolves:** the person, by default. An agent resolving its own question once answered would save a step. But it would also let an agent close a question whose answer it misread, so the default should stay with the person.

<a id="NOTE-00102" data-uid="k0u2kgrwgt49"></a>
### A Person Asks, an Agent Answers

A reviewer leaves a thread on a section: "Does this cover expired sessions?" or "Split this into two requirements". Later they tell their agent to deal with the open threads in a folder.

- **Addressing:** threads have no assignee (Step 012 decided against ownership). A mention convention (`@agent`) is enough to start with. The CLI could filter on it, and a real field could follow if the convention proves useful.
- **Starting the agent:** Specquer doesn't run the agent (see the scope in [Ideas](/notes/ideas)). The person starts it. A hook or a scheduled agent run could pick up addressed threads later, but that is outside Specquer.
- **Answering:** the agent replies with what it did, or with why it didn't. If the request needs a decision, it asks back in the same thread.

<a id="NOTE-00103" data-uid="sewj1foa3szr"></a>
### What Both Need

- **Telling people from agents:** `createdBy` is the Git user's name today. Comments an agent writes should say so, for example `Claude Code (for Martin Nordberg)`, or carry an optional `agent:` field that the pane shows as a badge. A field is easier to filter on, but it changes the sidecar's schema.
- **Comment text is untrusted input to an agent.** A thread is a request from a collaborator, not an instruction from the user who runs the agent. An agent reading threads should handle them as it handles an issue it was asked to work on, under the same permissions, and a comment can't widen what the agent may do. The skill should say this, and so should the CLI's `--help`.
- **Volume:** an eager agent can open dozens of threads in one pass. The skill should ask for a few threads that each matter, and the pane's filter already helps. A thread count per run, printed by the CLI, makes a flood easy to notice.
- **Stale threads:** a section rewritten after a thread was opened still holds the thread. A deleted section leaves the thread detached, as Step 012 already handles.
- **Concurrent writes:** an agent and a person can work in the same document at the same time. A reply is an append. An edit to a comment that changed in the meantime is refused (R3.3). When Specquer is running, the CLI sends its changes through the server, so they don't race the browser's writes.

<a id="NOTE-00104" data-uid="ukoc0fli7n2z"></a>
## Open Questions

1. Agent authorship as a naming convention, or an `agent` field in the sidecar?
2. Should the CLI name sections by ID only, or also by heading text, as people often do?
3. May an agent resolve a thread, and if so, which threads?
4. Should comments join the chat's search index (left out in Step 012), so the chat can answer from them?
5. A mention convention, or an assignee field?
