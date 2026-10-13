<a id="NOTE-00053" data-uid="s7yo3smsj4ce"></a>

<a id="NOTE-00054" data-uid="iti1vz739hsj"></a>
# LangChain.js or the Vercel AI SDK

_Notes from October 2026._

**Summary:** Switching `agent` from LangChain.js to the Vercel AI SDK would be cheap today, because Specquer uses very little of LangChain. It would bring a lighter executable, a simpler API, a clean OpenAI-compatible provider for NVIDIA and one fewer telemetry hazard. It would cost LangGraph: durable, stateful, multi-step workflows with checkpoints and approvals. The choice depends on the agent features planned next, not on the summaries as they are.

<a id="NOTE-00055" data-uid="p4lspp3o56j2"></a>
## What Specquer Uses Today

Very little. `agent/src` is about 450 lines, and LangChain appears in two files:

- `model.ts`: `ChatOpenAI` at NVIDIA's URL, `BaseChatModel` as the type callers see, `.invoke()`, and `lc_error_code` in `modelTestProblem`.
- `summarize.ts`: `SystemMessage` and `HumanMessage`, `.invoke()` with a signal, and `messageText()` to flatten the content.
- `summarize.test.ts`: `FakeListChatModel`.

There are no tools, structured output, streaming, agents or LangGraph yet. The token budget, the fallback for long sections, the cache and the queue are Specquer's own code. A migration would rewrite `model.ts`, the prompt builder, one test file and the documentation. `server` sees only `ChatModel` and `ResolvedModel` (and stubs `invoke`), so it would change little.

<a id="NOTE-00056" data-uid="cbq8mki23bf9"></a>
## Benefits of the Vercel AI SDK

- **A smaller dependency tree:** `langchain` brings `@langchain/langgraph`, `langsmith` and more. `ai` with `@ai-sdk/openai-compatible` is much lighter, which matters because everything is embedded in the single executable. It also removes the hazard of LangSmith tracing; the AI SDK's OpenTelemetry is off unless enabled per call.
- **A simpler API for summaries:** `generateText({ model, system, prompt, abortSignal, maxRetries, temperature, maxOutputTokens })` returns `text` as a string, with no message classes and no unwrapping of string-or-array content.
- **NVIDIA fits cleanly:** `createOpenAICompatible({ baseURL, apiKey, name })` is meant for such hosts. Specquer now borrows `ChatOpenAI` because `initChatModel` has no NVIDIA entry.
- **Provider switching:** `@ai-sdk/anthropic`, `@ai-sdk/google` and the others share one `LanguageModel` interface, and a provider registry gives `"provider:model"` strings, which covers what `initChatModel` was planned for.
- **Plainer errors:** `APICallError` has `statusCode` and `isRetryable`, so `modelTestProblem` wouldn't depend on `lc_error_code`.
- **Zod:** `generateObject` (or `Output`) and `tool({ inputSchema })` take Zod schemas directly. The workspace still needs a single `zod` version in `bun.lock`.
- **A smaller API surface:** the AI SDK has had breaking major versions too (v4 to v5 was large), but there is far less of it to track than in LangChain.
- **A streaming UI if chat comes:** AI SDK UI (`useChat`) works with a Hono streaming route. The client would depend on `@ai-sdk/react`, not on `agent`, so the rule that `client` never depends on `agent` holds.

<a id="NOTE-00057" data-uid="c4mvvhovxstl"></a>
## Costs

- **No LangGraph equivalent:** the [technical architecture](/specifications/technical-architecture) names LangGraph for stateful, multi-step workflows. The AI SDK has tool-calling loops (`stopWhen`, its `Agent` abstraction), but no durable state graphs, checkpointing, interrupt and resume for a human's approval, or replay. Agents that edit specs with approval, or long jobs that survive a restart, would have to be built by hand.
- **Fewer building blocks:** LangChain has text splitters, retrievers, vector stores and document loaders. Search or question answering over the specs would need them written or found elsewhere.
- **Rework of settled decisions:** §6 of the technical architecture, the [data architecture](/specifications/data-architecture), the LangChain rules in `CLAUDE.md`, the rules for test doubles and the cache key would all change. If the request the model sees changes, `PROMPT_VERSION` must be raised. Summaries as they work today gain nothing from this.
- **Test doubles:** `MockLanguageModelV*` from `ai/test` would replace `FakeListChatModel`; it works but is lower level, with result objects built by hand. `e2e/fake-model.ts` stays, since it fakes the HTTP API.
- **Vercel-centric defaults:** the core is provider-neutral and runs on Bun, but the documentation and some features (the AI Gateway, and `"provider/model"` strings that default to it) assume Vercel. A rule like the one against LangSmith tracing would be needed so that no call goes to the gateway by default.

<a id="NOTE-00058" data-uid="mdwe83tff1ww"></a>
## Conclusion

- **If `agent` stays with summaries and simple tool use:** switch. The change is small and contained, and now, before more code depends on `BaseChatModel`, is the cheapest time.
- **If graph-shaped workflows are coming (checkpoints, approvals, resumable runs):** stay. LangGraph is the real reason to keep LangChain; the summary code doesn't suffer from it.

Either way, `ChatModel` and `ResolvedModel` already keep the library away from `server`. Narrowing them to Specquer's own small interface (such as `complete(system, prompt, signal): Promise<string>`) would make either choice cheap to reverse. See also [Agent-Delegated Summaries](/notes/agent-delegated-summaries), which compares the two libraries for running a coding agent as the model.
