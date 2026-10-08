import { z } from "zod";

/**
 * The agent configuration, `.specquer/shared/agent.config.yaml`, with an optional personal
 * override in `.specquer/user/agent.config.yaml`. `model:` applies to every agent feature;
 * `summaries:` holds the summarization settings. The configuration never holds API keys: it
 * names the environment variable that does.
 */

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export const modelConfigSchema = z.object({
  /** Only NVIDIA's hosted models (OpenAI-compatible API) in this version. */
  provider: z.literal("nvidia"),
  /** The provider's model ID. */
  name: z.string().trim().min(1),
  baseUrl: z.url({ protocol: /^https?$/ }).default(NVIDIA_BASE_URL),
  /** The environment variable holding the API key. */
  apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an environment variable name"),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const summariesConfigSchema = z.object({
  /** How many model calls run at once. */
  concurrency: z.number().int().min(1).max(16).default(2),
  /** Sections estimated above this many tokens are summarized from their subsections' summaries. */
  tokenBudget: z.number().int().min(1000).max(1_000_000).default(24_000),
});
export type SummariesConfig = z.infer<typeof summariesConfigSchema>;

export interface AgentConfig {
  model?: ModelConfig;
  summaries: SummariesConfig;
}

/** One file's settings, before merging: only what it sets. */
export interface AgentConfigFile {
  model?: ModelConfig;
  summaries: Partial<SummariesConfig>;
}

export const DEFAULT_SUMMARIES: SummariesConfig = summariesConfigSchema.parse({});

function issues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "value"} ${issue.message}`.trim()).join("; ");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parses one file's content (already read as YAML). Unknown keys are ignored; an invalid `model:`
 * is dropped and an invalid summaries setting falls back alone, each reported through `warn`.
 */
export function parseAgentConfig(value: unknown, source: string, warn: (message: string) => void = () => {}): AgentConfigFile {
  const result: AgentConfigFile = { summaries: {} };
  if (value === null || value === undefined) return result;
  if (!isRecord(value)) {
    warn(`${source}: expected a mapping`);
    return result;
  }
  if (value.model !== undefined && value.model !== null) {
    const model = modelConfigSchema.safeParse(value.model);
    if (model.success) result.model = model.data;
    else warn(`${source}: ignoring 'model': ${issues(model.error)}`);
  }
  const summaries = value.summaries;
  if (summaries !== undefined && summaries !== null) {
    if (!isRecord(summaries)) warn(`${source}: 'summaries' must be a mapping`);
    else {
      for (const key of ["concurrency", "tokenBudget"] as const) {
        if (summaries[key] === undefined) continue;
        const field = summariesConfigSchema.shape[key].safeParse(summaries[key]);
        if (field.success) result.summaries[key] = field.data;
        else warn(`${source}: ignoring 'summaries.${key}': ${issues(field.error)}`);
      }
    }
  }
  return result;
}

/**
 * Merges the shared and the personal configuration (decision D7): the personal file overrides
 * key by key under `summaries:`, and its `model:` replaces the shared one as a whole.
 */
export function mergeAgentConfig(shared: AgentConfigFile, user: AgentConfigFile): AgentConfig {
  const model = user.model ?? shared.model;
  return {
    ...(model === undefined ? {} : { model }),
    summaries: { ...DEFAULT_SUMMARIES, ...shared.summaries, ...user.summaries },
  };
}
