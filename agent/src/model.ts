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

export type ResolvedModel = { ok: true; model: ChatModel; id: string } | { ok: false; problem: string };

/** How long one call may take. */
export const MODEL_TIMEOUT = 120_000;

export function createChatModel(config: ModelConfig | undefined, env: Record<string, string | undefined>): ResolvedModel {
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
    timeout: MODEL_TIMEOUT,
    // Rate limits are reported to the user, who can retry, rather than retried for minutes
    maxRetries: 1,
  });
  return { ok: true, model, id: config.name };
}
