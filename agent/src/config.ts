import type { z } from "zod";
import {
  CHAT_SETTING_KEYS,
  type ChatConfig,
  DEFAULT_CHAT,
  DEFAULT_SUMMARIES,
  type ModelConfig,
  SUMMARY_SETTING_KEYS,
  type SummariesConfig,
  chatSettingSchemas,
  modelConfigSchema,
  summarySettingSchemas,
} from "@specquer/shared/settings";

/**
 * The agent configuration, `.specquer/shared/agent.config.yaml`, with an optional personal
 * override in `.specquer/user/agent.config.yaml`. `model:` applies to every agent feature;
 * `summaries:` holds the summarization settings and `chat:` the document chat's. The configuration never holds API keys: it
 * names the environment variable that does. The schemas are in `@specquer/shared/settings`, so the
 * settings dialog validates with them too.
 */

export {
  type ChatConfig,
  DEFAULT_CHAT,
  DEFAULT_SUMMARIES,
  type ModelConfig,
  NVIDIA_BASE_URL,
  type SummariesConfig,
  chatConfigSchema,
  modelConfigSchema,
  summariesConfigSchema,
} from "@specquer/shared/settings";

export interface AgentConfig {
  model?: ModelConfig;
  summaries: SummariesConfig;
  chat: ChatConfig;
}

/** One file's settings, before merging: only what it sets. */
export interface AgentConfigFile {
  model?: ModelConfig;
  summaries: Partial<SummariesConfig>;
  /** Present when the file sets any chat setting. */
  chat?: Partial<ChatConfig>;
}

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
  result.summaries = parseBlock(value, "summaries", SUMMARY_SETTING_KEYS, summarySettingSchemas, source, warn) as Partial<SummariesConfig>;
  const chat = parseBlock(value, "chat", CHAT_SETTING_KEYS, chatSettingSchemas, source, warn) as Partial<ChatConfig>;
  if (Object.keys(chat).length > 0) result.chat = chat;
  return result;
}

/** A settings block (`summaries:`, `chat:`): each valid key, an invalid one reported and ignored alone. */
function parseBlock<K extends string>(
  value: Record<string, unknown>,
  name: string,
  keys: readonly K[],
  schemas: Record<K, z.ZodType>,
  source: string,
  warn: (message: string) => void,
): Record<string, unknown> {
  const block = value[name];
  const result: Record<string, unknown> = {};
  if (block === undefined || block === null) return result;
  if (!isRecord(block)) {
    warn(`${source}: '${name}' must be a mapping`);
    return result;
  }
  for (const key of keys) {
    if (block[key] === undefined) continue;
    const field = schemas[key].safeParse(block[key]);
    if (field.success) result[key] = field.data;
    else warn(`${source}: ignoring '${name}.${key}': ${issues(field.error)}`);
  }
  return result;
}

/**
 * Merges the shared and the personal configuration (decision D7): the personal file overrides
 * key by key under `summaries:` and `chat:`, and its `model:` replaces the shared one as a whole.
 */
export function mergeAgentConfig(shared: AgentConfigFile, user: AgentConfigFile): AgentConfig {
  const model = user.model ?? shared.model;
  return {
    ...(model === undefined ? {} : { model }),
    summaries: { ...DEFAULT_SUMMARIES, ...shared.summaries, ...user.summaries },
    chat: { ...DEFAULT_CHAT, ...shared.chat, ...user.chat },
  };
}
