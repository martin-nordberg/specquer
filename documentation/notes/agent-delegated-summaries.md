<a id=""></a>

<a id=""></a>
# Summaries Delegated to a Coding Agent

_Notes from October 2026._

**Summary:** Specquer could hand summarizing to a coding agent (Claude Code, Codex) running next to it, instead of calling a chat model itself. LangChain can do this about as easily as the Vercel AI SDK, but delegation is slower, costs more and carries more risk than the current per-section design. If the goal is better summaries, a frontier provider package behind the existing configuration gets most of the gain. Delegation pays off mainly for setup without an API key and for summarizing a whole document with the repository as context. For that, an MCP server that the user's own agent calls is a cleaner design than wrapping the agent as a model.

<a id=""></a>
## Two Designs

1. **The agent stands in for the model.** For each summary request, Specquer runs a headless agent (the Claude Agent SDK's `query()`, `claude -p`, `codex exec`) and reads back the text. Specquer stays in charge, and its cache, call queue and API stay as they are.
2. **The agent is a peer.** The user's own running agent session does the work. Specquer offers the work through an MCP server (tools such as "list stale summaries" and "write summary") or through files, and the agent pulls it. Specquer never calls a model.

<a id=""></a>
## Vercel AI SDK and LangChain

The Vercel AI SDK makes the first design easy through community providers (`ai-sdk-provider-claude-code`, `ai-sdk-provider-codex-cli`). They make the agent look like a model, so `generateText({ model: claudeCode("sonnet") })` works.

As far as we know, LangChain.js has no packaged equivalent; check again before building. None is needed:

- `summarize.ts` already takes a `BaseChatModel`. A custom subclass in `agent/src/model.ts` whose `_generate` calls the Agent SDK or starts the CLI is about 50–100 lines. `provider: claude-code` in `agent.config.yaml` would then pick it, and `summarize.ts`, the queue, the cache and the API wouldn't change.
- `FakeListChatModel` would still cover the unit tests. The end-to-end tests would need a fake CLI next to `e2e/fake-model.ts`.

For the first design the framework hardly matters: either way it's one adapter. The second design needs no framework at all, only an MCP server in `server`.

<a id=""></a>
## Performance

- **Startup cost per call:** every agent run starts a process and sends a large system prompt (tool definitions, `CLAUDE.md` or `AGENTS.md`). Even with prompt caching, that means seconds and thousands of tokens per call, against roughly a second for a direct chat completion.
- **Poor fit with one call per section:** the current design makes one call per section with a concurrency of 2. To make an agent workable, Specquer would batch: one agent run summarizes a whole document or every stale section. That means reworking the queue, the sharing of identical calls, and aborts.
- **Costlier aborts:** the queue lets started calls finish. With agent runs, each unwanted run that finishes costs far more.
- **Shared rate limits:** if the agent runs on the user's subscription, summaries use up the same allowance as their interactive coding work.
- **Fewer calls with a peer:** in the second design, an agent that already has the repository in context can write all the summaries in one session.

<a id=""></a>
## Complexity and Risk

- **Prompt injection with tools:** `summarize.ts` already treats spec text as untrusted, because a spec can steer the model. A coding agent has file-write and shell tools, so the same prompt injection can get actions run on the machine. The tools would have to be turned off (`allowedTools` and `disallowedTools` in the Agent SDK, `--sandbox read-only` in Codex). Once they are, what's left is mostly an expensive chat model.
- **Data leaving the machine:** the [security specification](/specifications/security) and the rule that nothing leaves the machine without a key would need revisiting. The agent sends data to its vendor and can read outside the root folder.
- **Operations:** Specquer would have to detect whether the CLI is installed, check its version and login state, and handle chatty output, either with structured output or by relying on `toPlainText` to clean it up.
- **A fuzzier cache key:** today the key is the model plus `PROMPT_VERSION`. Agent output also depends on the agent's version, its instruction files and the state of the repository.
- **Subscription terms:** before relying on a user's Claude or ChatGPT plan login for Specquer's own calls, check the vendor's current terms for third-party apps.

<a id=""></a>
## Benefits

- **No API key to set up:** the agent's existing login is reused, and it likely brings a stronger model than Gemma.
- **Repository context:** the agent can read the glossary and linked sections, and keep a document's summaries consistent across levels in one pass. That suits Step 004's hierarchy.
- **A natural fit for the peer design:** the user's agent could write summaries while working on a spec, and the summaries could even be committed.

<a id=""></a>
## Conclusion

As a replacement for the current on-demand, per-section summaries, the first design is slower, costlier and riskier than what Specquer has now, and LangChain makes it no harder than the Vercel AI SDK would.

- **Better summaries:** add a frontier provider package such as `@langchain/anthropic` behind the existing configuration.
- **No-key setup and summaries of whole documents with repository context:** use the second design, an MCP server in `server` that the user's agent calls.
