import { z } from "zod";
import { isPrefix } from "../sections/ids.ts";

/**
 * The settings Specquer edits in its dialogs, shared so the client validates them as the server
 * does. The agent configuration (`agent.config.yaml`, shared and personal) holds `model:` and
 * `summaries:`; a folder's `.specquer-config.yaml` holds its type and default prefix.
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

/** Each chat setting alone, without its default, for validating one value (Step 010). */
export const chatSettingSchemas = {
  /** Retrieved sections sent with a question. */
  units: z.number().int().min(1).max(20),
  /** Their budget, in estimated tokens. */
  contextTokens: z.number().int().min(1000).max(100_000),
  /** Earlier questions and answers sent with a question. */
  historyTurns: z.number().int().min(0).max(50),
  /** Their budget, in estimated tokens. */
  historyTokens: z.number().int().min(0).max(100_000),
  /** The longest answer, in tokens: the model stops there. */
  answerTokens: z.number().int().min(256).max(32_000),
};

export const chatConfigSchema = z.object({
  units: chatSettingSchemas.units.default(8),
  contextTokens: chatSettingSchemas.contextTokens.default(12_000),
  historyTurns: chatSettingSchemas.historyTurns.default(10),
  historyTokens: chatSettingSchemas.historyTokens.default(8_000),
  answerTokens: chatSettingSchemas.answerTokens.default(4_000),
});
export type ChatConfig = z.infer<typeof chatConfigSchema>;

export const CHAT_SETTING_KEYS = ["units", "contextTokens", "historyTurns", "historyTokens", "answerTokens"] as const;
export type ChatSettingKey = (typeof CHAT_SETTING_KEYS)[number];

export const DEFAULT_CHAT: ChatConfig = chatConfigSchema.parse({});

/** Which agent configuration file a setting is written to. */
export type SettingsScope = "shared" | "personal";

/** Where a value in effect comes from. */
export type SettingSource = SettingsScope | "default";

export const prefixSchema = z.string().refine(isPrefix, "A prefix is an upper-case letter followed by 1 to 4 upper-case letters or digits.");

/** The file holding a folder's settings, in the folder itself. */
export const FOLDER_CONFIG_FILE = ".specquer-config.yaml";

/**
 * A folder's type: baseline specs (the current or intended state of the whole system), change
 * specs (the work for a task or feature), auxiliary specs (sectioned, not updated from change
 * specs), or Markdown that Specquer doesn't section. The three sectioned types behave alike for now.
 */
export const FOLDER_TYPES = ["BASELINE", "CHANGE", "AUXILIARY", "NONSECTIONED"] as const;
export const folderTypeSchema = z.enum(FOLDER_TYPES);
export type FolderType = z.infer<typeof folderTypeSchema>;

export function isSectionedType(type: FolderType | null | undefined): boolean {
  return type !== null && type !== undefined && type !== "NONSECTIONED";
}

/**
 * A folder's own settings, as its `.specquer-config.yaml` holds them: each key set, or inherited
 * from the nearest folder above that sets it.
 */
export const folderSettingSchema = z.object({
  folderType: z.union([z.literal("inherit"), folderTypeSchema]),
  defaultPrefix: z.union([z.literal("inherit"), prefixSchema]),
});
export type FolderSetting = z.infer<typeof folderSettingSchema>;

/** The file holding a prefix's settings, hand-edited for now: `.specquer/shared/<prefix>/prefix.config.yaml`. */
export const PREFIX_CONFIG_FILE = "prefix.config.yaml";

/** A status: text, not blank, without `"` (it is written in an attribute). */
export const statusValueSchema = z
  .string()
  .trim()
  .min(1, "A status can't be blank.")
  .refine((value) => !value.includes('"'), 'A status can\'t hold ".');

/** A prefix's settings: the allowed statuses, in order, the first being the default. */
export const prefixConfigSchema = z.object({
  statusValues: z
    .array(statusValueSchema)
    .min(1, "The list of statuses is empty.")
    .refine((values) => new Set(values.map((value) => value.toLowerCase())).size === values.length, "A status is listed twice."),
});
export type PrefixConfig = z.infer<typeof prefixConfigSchema>;
