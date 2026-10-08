import {
  type AgentConfig,
  type ChatModel,
  type ModelConfig,
  PROMPT_VERSION,
  type ResolvedModel,
  type SectionInput,
  type SummaryOutput,
  createChatModel,
  sectionInput,
  summarizeSection,
  summarizeWithFallback,
} from "@specquer/agent";
import { ApiError, type SummaryRequest, type SummaryResult, type SummaryStatus } from "@specquer/shared/api";
import { isShortSection } from "@specquer/shared/summaries";
import { SummaryCache, cacheKey } from "./cache.ts";
import { AgentConfigFiles } from "./config.ts";
import { CallQueue } from "./queue.ts";

/**
 * The summary service: short sections come back as written, cached summaries at once, the rest
 * through the call queue. Summarization is opt-in: without a configured model and its key,
 * nothing leaves the machine.
 */

const DAY = 24 * 60 * 60 * 1000;

export interface SummaryServiceOptions {
  /** Where API keys come from: the server's environment. */
  env?: Record<string, string | undefined>;
  createModel?: (config: ModelConfig | undefined, env: Record<string, string | undefined>) => ResolvedModel;
  now?: () => number;
  warn?: (message: string) => void;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** Maps a provider failure to the API's errors: the rate limit to 429, anything else to 502. */
export function providerError(err: unknown): ApiError {
  const status = (err as { status?: unknown }).status;
  const code = (err as { lc_error_code?: unknown }).lc_error_code;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 429 || code === "MODEL_RATE_LIMIT") {
    return new ApiError(429, "rate_limited", "The model provider's rate limit was reached. Try again in a minute.");
  }
  return new ApiError(502, "provider_error", `The model provider failed: ${message.split("\n")[0]}`);
}

export class SummaryService {
  private readonly config: AgentConfigFiles;
  private readonly cache: SummaryCache;
  private readonly queue: CallQueue;
  private readonly env: Record<string, string | undefined>;
  private readonly createModel: NonNullable<SummaryServiceOptions["createModel"]>;
  private readonly now: () => number;
  private concurrency = 2;
  private resolved: { signature: string; model: ResolvedModel } | null = null;
  private purgedAt = -Infinity;

  constructor(root: string, options: SummaryServiceOptions = {}) {
    this.env = options.env ?? process.env;
    this.createModel = options.createModel ?? createChatModel;
    this.now = options.now ?? Date.now;
    this.config = new AgentConfigFiles(root, options.warn);
    this.cache = new SummaryCache(root, this.now, options.warn);
    this.queue = new CallQueue(() => this.concurrency);
  }

  /** Deletes expired summaries; at startup only if a cache exists, then at most once a day. */
  async purge(): Promise<void> {
    if (this.now() - this.purgedAt < DAY) return;
    this.purgedAt = this.now();
    if (await this.cache.exists()) await this.cache.purge();
  }

  private async current(): Promise<{ config: AgentConfig; model: ResolvedModel }> {
    const config = await this.config.load();
    this.concurrency = config.summaries.concurrency;
    const key = config.model === undefined ? undefined : this.env[config.model.apiKeyEnv];
    const signature = JSON.stringify([config.model, key]);
    if (this.resolved?.signature !== signature) this.resolved = { signature, model: this.createModel(config.model, this.env) };
    return { config, model: this.resolved.model };
  }

  async status(): Promise<SummaryStatus> {
    const { model } = await this.current();
    return model.ok ? { enabled: true, model: model.id } : { enabled: false, problem: model.problem };
  }

  async summarize(request: SummaryRequest, signal: AbortSignal): Promise<SummaryResult> {
    const { config, model } = await this.current();
    if (!model.ok) throw new ApiError(503, "not_configured", model.problem);
    void this.purge();
    const input = sectionInput(request.text, request.path, request.headings);
    if (isShortSection(input.text)) return { summary: input.text, model: model.id, cached: false, truncated: false };
    try {
      return { ...(await this.summarizeInput(input, model.model, model.id, config.summaries.tokenBudget, signal)), model: model.id };
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw err;
      throw err instanceof ApiError ? err : providerError(err);
    }
  }

  /** A section's summary: from the cache, or made (from its subsections' summaries if it is long) and cached. */
  private async summarizeInput(
    input: SectionInput,
    model: ChatModel,
    modelId: string,
    tokenBudget: number,
    signal: AbortSignal,
  ): Promise<SummaryOutput & { cached: boolean }> {
    const key = cacheKey(input.text, modelId, PROMPT_VERSION, input.sentences);
    const cached = await this.cache.get(key);
    if (cached !== undefined) return { summary: cached.summary, truncated: cached.truncated, cached: true };
    const result = await summarizeWithFallback(input, tokenBudget, {
      summarizePart: (part) => this.summarizeInput(part, model, modelId, tokenBudget, signal),
      call: (callInput) =>
        this.queue.run(
          cacheKey(callInput.text, modelId, PROMPT_VERSION, callInput.sentences),
          (callSignal) => summarizeSection(model, callInput, { signal: callSignal }),
          signal,
        ),
    });
    await this.cache.put(key, PROMPT_VERSION, { summary: result.summary, model: modelId, truncated: result.truncated });
    return { ...result, cached: false };
  }

  close(): void {
    this.cache.close();
  }
}
