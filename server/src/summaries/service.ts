import {
  type AgentConfig,
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
import { ApiError, type SectionSummaryLookup, type SummaryRequest, type SummaryResult, type SummaryStatus } from "@specquer/shared/api";
import { isShortSection } from "@specquer/shared/summaries";
import type { FileService } from "../files.ts";
import type { SectionIndex } from "../sections/section-index.ts";
import { SummaryCache, textKey } from "./cache.ts";
import { AgentConfigFiles } from "./config.ts";
import { lookupSection } from "./lookup.ts";
import { PREFILL_BACKOFF, PREFILL_DELAY, PREFILL_MAX_BACKOFF, Prefill } from "./prefill.ts";
import { CallQueue, type Priority } from "./queue.ts";

/**
 * The summary service: short sections come back as written, cached summaries at once, the rest
 * through the call queue. Summarization is opt-in: without a configured model and its key,
 * nothing leaves the machine. It also looks summaries up by section ID (from the cache only) and,
 * when switched on, pre-fills the cache in the background.
 */

const DAY = 24 * 60 * 60 * 1000;

export interface SummaryServiceOptions {
  /** Where API keys come from: the server's environment. */
  env?: Record<string, string | undefined>;
  createModel?: (config: ModelConfig | undefined, env: Record<string, string | undefined>) => ResolvedModel;
  now?: () => number;
  warn?: (message: string) => void;
  /** How long pre-filling waits after it is triggered (10 s). */
  prefillDelay?: number;
  /** The first pause after a rate limit while pre-filling (1 min); it doubles up to 15 min. */
  prefillBackoff?: number;
}

/** Where the service reads documents: for lookups by section ID and for pre-filling. */
export interface SummarySources {
  files: FileService;
  sections: SectionIndex;
}

type ReadyModel = Extract<ResolvedModel, { ok: true }>;

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** Whether a provider failure is its rate limit. */
export function isRateLimit(err: unknown): boolean {
  const status = (err as { status?: unknown }).status;
  const code = (err as { lc_error_code?: unknown }).lc_error_code;
  return status === 429 || code === "MODEL_RATE_LIMIT";
}

/** Maps a provider failure to the API's errors: the rate limit to 429, anything else to 502. */
export function providerError(err: unknown): ApiError {
  const message = err instanceof Error ? err.message : String(err);
  if (isRateLimit(err)) {
    return new ApiError(429, "rate_limited", "The model provider's rate limit was reached. Try again in a minute.");
  }
  return new ApiError(502, "provider_error", `The model provider failed: ${message.split("\n")[0]}`);
}

export class SummaryService {
  private readonly config: AgentConfigFiles;
  private readonly cache: SummaryCache;
  private readonly queue: CallQueue;
  private readonly prefill: Prefill;
  private readonly env: Record<string, string | undefined>;
  private readonly createModel: NonNullable<SummaryServiceOptions["createModel"]>;
  private readonly now: () => number;
  private concurrency = 2;
  private resolved: { signature: string; model: ResolvedModel } | null = null;
  /** What pre-filling last ran with: whether it may run, and the model. */
  private prefillSignature: string | null = null;
  private purgedAt = -Infinity;

  constructor(
    root: string,
    private readonly sources: SummarySources,
    options: SummaryServiceOptions = {},
  ) {
    this.env = options.env ?? process.env;
    this.createModel = options.createModel ?? createChatModel;
    this.now = options.now ?? Date.now;
    const warn = options.warn ?? ((message: string) => console.warn(`specquer: ${message}`));
    this.config = new AgentConfigFiles(root, warn);
    this.cache = new SummaryCache(root, this.now, warn);
    this.queue = new CallQueue(() => this.concurrency);
    this.prefill = new Prefill(
      {
        ready: async () => {
          const { config, model } = await this.current();
          return config.summaries.prefill && model.ok ? model.key : undefined;
        },
        slots: () => Math.max(1, this.concurrency - 1),
        files: () => sources.files.listMarkdownFiles(),
        stamp: async (path) => {
          const stamp = await sources.files.fileStamp(path);
          return stamp === undefined ? undefined : `${stamp.mtimeMs}:${stamp.size}`;
        },
        read: (path) => sources.files.readFile(path).then((file) => file.text, () => undefined),
        summarize: async (path, target, signal) => {
          const { config, model } = await this.current();
          // Switched off meanwhile: the restart stops the pass
          if (!model.ok || !config.summaries.prefill) return;
          const input = sectionInput(target.text, path, target.headings);
          if (isShortSection(input.text)) return;
          await this.summarizeInput(input, model, config.summaries.tokenBudget, signal, "background");
        },
        isRateLimit,
        warn,
      },
      {
        delay: options.prefillDelay ?? PREFILL_DELAY,
        backoff: options.prefillBackoff ?? PREFILL_BACKOFF,
        maxBackoff: PREFILL_MAX_BACKOFF,
        now: this.now,
      },
    );
  }

  /** Deletes summaries unused for 60 days; at startup only if a cache exists, then at most once a day. */
  async purge(): Promise<void> {
    if (this.now() - this.purgedAt < DAY) return;
    this.purgedAt = this.now();
    if (await this.cache.exists()) await this.cache.purge();
  }

  /** Starts pre-filling (after its delay), if it is switched on; again after files change. */
  filesChanged(): void {
    this.prefill.trigger();
  }

  private async current(): Promise<{ config: AgentConfig; model: ResolvedModel }> {
    const config = await this.config.load();
    this.concurrency = config.summaries.concurrency;
    const key = config.model === undefined ? undefined : this.env[config.model.apiKeyEnv];
    const signature = JSON.stringify([config.model, key]);
    if (this.resolved?.signature !== signature) this.resolved = { signature, model: this.createModel(config.model, this.env) };
    const model = this.resolved.model;
    // Switched on or off, or another model: pre-filling starts again
    const prefillSignature = config.summaries.prefill && model.ok ? model.key : "";
    if (this.prefillSignature !== null && this.prefillSignature !== prefillSignature) this.prefill.restart();
    this.prefillSignature = prefillSignature;
    return { config, model };
  }

  async status(): Promise<SummaryStatus> {
    const { config, model } = await this.current();
    const prefill = { enabled: model.ok && config.summaries.prefill, pending: this.prefill.pending };
    return model.ok ? { enabled: true, model: model.id, prefill } : { enabled: false, problem: model.problem, prefill };
  }

  async summarize(request: SummaryRequest, signal: AbortSignal): Promise<SummaryResult> {
    const { config, model } = await this.current();
    if (!model.ok) throw new ApiError(503, "not_configured", model.problem);
    void this.purge();
    const input = sectionInput(request.text, request.path, request.headings);
    if (isShortSection(input.text)) return { summary: input.text, model: model.id, cached: false, truncated: false, current: true };
    if (request.accept === "any") {
      // Another model's summary at once; the client asks again for the configured model's
      const found = await this.cache.best(textKey(input.text, input.sentences), model.key, PROMPT_VERSION);
      if (found !== undefined) return { summary: found.summary, model: found.model, cached: true, truncated: found.truncated, current: found.current };
    }
    try {
      return { ...(await this.summarizeInput(input, model, config.summaries.tokenBudget, signal, "interactive")), model: model.id, current: true };
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw err;
      throw err instanceof ApiError ? err : providerError(err);
    }
  }

  /** A section's summary by its ID, from the cache only (never a model call). */
  async sectionSummary(id: string): Promise<SectionSummaryLookup> {
    const { model } = await this.current();
    return lookupSection(id, {
      find: (sectionId) => this.sources.sections.find(sectionId),
      best: (text, sentences) => this.cache.best(textKey(text, sentences), model.ok ? model.key : undefined, PROMPT_VERSION),
    });
  }

  /** A section's summary: from the cache, or made (from its subsections' summaries if it is long) and cached. */
  private async summarizeInput(
    input: SectionInput,
    model: ReadyModel,
    tokenBudget: number,
    signal: AbortSignal,
    priority: Priority,
  ): Promise<SummaryOutput & { cached: boolean }> {
    const key = { text: textKey(input.text, input.sentences), model: model.key, promptVersion: PROMPT_VERSION };
    const cached = await this.cache.get(key);
    if (cached !== undefined) return { summary: cached.summary, truncated: cached.truncated, cached: true };
    const result = await summarizeWithFallback(input, tokenBudget, {
      summarizePart: (part) => this.summarizeInput(part, model, tokenBudget, signal, priority),
      call: (callInput) => {
        const callKey = textKey(callInput.text, callInput.sentences);
        return this.queue.run(
          `${model.key}\n${callKey}`,
          async () => {
            const summary = await summarizeSection(model.model, callInput);
            // A section summarized whole is cached here, so a call whose request is gone is kept
            if (callKey === key.text) await this.cache.put(key, { summary, model: model.id, truncated: false });
            return summary;
          },
          signal,
          priority,
        );
      },
    });
    await this.cache.put(key, { summary: result.summary, model: model.id, truncated: result.truncated });
    return { ...result, cached: false };
  }

  close(): void {
    this.prefill.close();
    this.cache.close();
  }
}
