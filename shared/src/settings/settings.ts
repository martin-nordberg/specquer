import { z } from "zod";
import { isPrefix } from "../sections/ids.ts";

/**
 * The settings Specquer edits in its dialogs, shared so the client validates them as the server
 * does. The agent configuration (`agent.config.yaml`, shared and personal) holds `model:` and
 * `summaries:`; the prefix configuration (`section-prefixes.config.yaml`) holds each folder's
 * setting.
 */

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/** An environment variable name, as `apiKeyEnv` holds it. */
export const API_KEY_ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const apiKeyEnvSchema = z.string().regex(API_KEY_ENV_PATTERN, "must be an environment variable name");

export const modelConfigSchema = z.object({
  /** Only NVIDIA's hosted models (OpenAI-compatible API) in this version. */
  provider: z.literal("nvidia"),
  /** The provider's model ID. */
  name: z.string().trim().min(1),
  baseUrl: z.url({ protocol: /^https?$/ }).default(NVIDIA_BASE_URL),
  /** The environment variable holding the API key. */
  apiKeyEnv: apiKeyEnvSchema,
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

/** Each summaries setting alone, without its default, for validating one value. */
export const summarySettingSchemas = {
  /** How many model calls run at once. */
  concurrency: z.number().int().min(1).max(16),
  /** Sections estimated above this many tokens are summarized from their subsections' summaries. */
  tokenBudget: z.number().int().min(1000).max(1_000_000),
  /**
   * Summarize every section of every Markdown file in the background, so the slider finds its
   * summaries made. Off by default: it sends every spec to the model provider.
   */
  prefill: z.boolean(),
};

export const summariesConfigSchema = z.object({
  concurrency: summarySettingSchemas.concurrency.default(2),
  tokenBudget: summarySettingSchemas.tokenBudget.default(24_000),
  prefill: summarySettingSchemas.prefill.default(false),
});
export type SummariesConfig = z.infer<typeof summariesConfigSchema>;

export const SUMMARY_SETTING_KEYS = ["concurrency", "tokenBudget", "prefill"] as const;
export type SummarySettingKey = (typeof SUMMARY_SETTING_KEYS)[number];

export const DEFAULT_SUMMARIES: SummariesConfig = summariesConfigSchema.parse({});

/** Which agent configuration file a setting is written to. */
export type SettingsScope = "shared" | "personal";

/** Where a value in effect comes from. */
export type SettingSource = SettingsScope | "default";

export const prefixSchema = z.string().refine(isPrefix, "A prefix is an upper-case letter followed by 1 to 4 upper-case letters or digits.");

/**
 * A folder's own entry in the prefix configuration: none (it inherits from the nearest folder
 * above that has one), not sectioned (`null` in the file), or sectioned with a prefix.
 */
export const folderSettingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inherit") }),
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("prefix"), prefix: prefixSchema }),
]);
export type FolderSetting = z.infer<typeof folderSettingSchema>;
