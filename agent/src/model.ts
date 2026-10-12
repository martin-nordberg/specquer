import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import type { ModelConfig } from "./config.ts";

/**
 * The chat model for a configuration. NVIDIA's hosted models speak OpenAI's API, so they are
 * reached through `ChatOpenAI` with NVIDIA's base URL. Other providers will come through
 * LangChain's `initChatModel("provider:model")` and their packages; this is the only place that
 * changes.
 */

/** A LangChain chat model, as the agent's callers see it. */
export type ChatModel = BaseChatModel;

/**
 * A configured model: `id` is its name, shown to the user; `key` identifies it in the cache, so
 * the same name at another host gets its own summaries.
 */
export type ResolvedModel = { ok: true; model: ChatModel; id: string; key: string } | { ok: false; problem: string };

/** The cache's identity for a model: provider, name and base URL. */
export function modelKey(config: ModelConfig): string {
  return `${config.provider}:${config.name}@${config.baseUrl}`;
}

/** How long one call may take. */
export const MODEL_TIMEOUT = 120_000;

/** Overrides for one use, such as the model test's shorter timeout. */
export interface ChatModelOptions {
  timeout?: number;
  maxRetries?: number;
}

export function createChatModel(
  config: ModelConfig | undefined,
  env: Record<string, string | undefined>,
  options: ChatModelOptions = {},
): ResolvedModel {
  if (config === undefined) return { ok: false, problem: "No model is configured in .specquer/shared/agent.config.yaml." };
  const apiKey = env[config.apiKeyEnv];
  if (apiKey === undefined || apiKey.trim() === "") {
    return { ok: false, problem: `The environment variable ${config.apiKeyEnv}, which holds the API key for ${config.name}, isn't set.` };
  }
  const model = new ChatOpenAI({
    model: config.name,
    apiKey,
    configuration: { baseURL: config.baseUrl },
    temperature: 0.2,
    maxTokens: 1024,
    timeout: options.timeout ?? MODEL_TIMEOUT,
    // Rate limits are reported to the user, who can retry, rather than retried for minutes
    maxRetries: options.maxRetries ?? 1,
  });
  return { ok: true, model, id: config.name, key: modelKey(config) };
}

/** How long the model test waits for an answer. */
export const MODEL_TEST_TIMEOUT = 30_000;

/** The model test's prompt: fixed, and holding nothing from the specs. */
export const MODEL_TEST_PROMPT = "Reply with the word OK.";

export type ModelTestResult = { ok: true; ms: number } | { ok: false; problem: string };

/** What went wrong in a model call, in the user's terms, with the API key never repeated. */
export function modelTestProblem(err: unknown, config: ModelConfig, apiKey: string | undefined): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as { status?: unknown; name?: unknown; lc_error_code?: unknown; message?: unknown };
  const message = typeof e.message === "string" ? e.message.split("\n")[0]! : String(err);
  const redacted = apiKey === undefined || apiKey === "" ? message : message.split(apiKey).join("***");
  if (e.status === 401 || e.status === 403 || e.lc_error_code === "MODEL_AUTHENTICATION") {
    return `The provider rejected the API key in ${config.apiKeyEnv}.`;
  }
  if (e.status === 404 || e.lc_error_code === "MODEL_NOT_FOUND") return `The provider doesn't know the model ${config.name} (or the URL is wrong).`;
  if (e.status === 429 || e.lc_error_code === "MODEL_RATE_LIMIT") return "The provider's rate limit was reached. Try again in a minute.";
  if (e.name === "TimeoutError") return `No answer within ${MODEL_TEST_TIMEOUT / 1000} seconds.`;
  if (e.name === "APIConnectionError" || /connection|ECONNREFUSED|ENOTFOUND|fetch failed|certificate/i.test(message)) {
    return `${config.baseUrl} can't be reached.`;
  }
  return `The provider failed: ${redacted}`;
}

/**
 * Checks a model configuration with one small call: the fixed prompt, a 30-second timeout and no
 * retries. Resolves to the time taken, or to the problem in the user's terms; rejects only when
 * `signal` aborts.
 */
export async function testModel(
  config: ModelConfig,
  env: Record<string, string | undefined>,
  signal: AbortSignal,
  create: typeof createChatModel = createChatModel,
  now: () => number = () => performance.now(),
): Promise<ModelTestResult> {
  const resolved = create(config, env, { timeout: MODEL_TEST_TIMEOUT, maxRetries: 0 });
  if (!resolved.ok) return { ok: false, problem: `${resolved.problem} Restart Specquer after setting it.` };
  const start = now();
  try {
    await resolved.model.invoke([{ role: "user", content: MODEL_TEST_PROMPT }], { signal });
    return { ok: true, ms: Math.round(now() - start) };
  } catch (err) {
    if (signal.aborted) throw err;
    return { ok: false, problem: modelTestProblem(err, config, env[config.apiKeyEnv]) };
  }
}
