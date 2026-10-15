import type { AgentSettings, AgentSettingsUpdate } from "@specquer/shared/api";
import {
  CHAT_SETTING_KEYS,
  type ChatSettingKey,
  DEFAULT_CHAT,
  DEFAULT_SUMMARIES,
  type ModelConfig,
  NVIDIA_BASE_URL,
  type SettingSource,
  type SettingsScope,
  type SummarySettingKey,
  chatSettingSchemas,
  modelConfigSchema,
  summarySettingSchemas,
} from "@specquer/shared/settings";

/**
 * The system settings dialog's form, apart from React: what each scope shows, the user's edits
 * (drafts), their validation with the shared schemas, and the saves they make.
 *
 * In **Personal** a field shows the value in effect (personal, else shared, else the default)
 * and where it comes from; in **Shared**, the shared file's value or the default, and whether a
 * personal value overrides it.
 */

export type ModelField = "name" | "baseUrl" | "apiKeyEnv";
export type ModelValues = Record<ModelField, string>;

export interface Shown<T> {
  value: T;
  source: SettingSource;
  /** In **Shared**: a personal value overrides this one. */
  overridden: boolean;
}

/** The model tab's edits: the values typed (null until a field is edited), or reset to the shared model. */
export interface ModelDraft {
  values: ModelValues | null;
  reset: boolean;
}

/** The summarization tab's edits: numbers as typed, and the settings reset to the shared value. */
export interface SummaryDraft {
  values: { concurrency?: string; tokenBudget?: string; prefill?: boolean };
  reset: ReadonlySet<SummarySettingKey>;
}

/** The chat tab's edits (Step 010): numbers as typed, and the settings reset to the shared value. */
export interface ChatDraft {
  values: Partial<Record<ChatSettingKey, string>>;
  reset: ReadonlySet<ChatSettingKey>;
}

export const emptyModelDraft = (): ModelDraft => ({ values: null, reset: false });
export const emptyChatDraft = (): ChatDraft => ({ values: {}, reset: new Set() });
export const isChatDirty = (draft: ChatDraft) => Object.keys(draft.values).length > 0 || draft.reset.size > 0;
export const emptySummaryDraft = (): SummaryDraft => ({ values: {}, reset: new Set() });

export const isModelDirty = (draft: ModelDraft) => draft.values !== null || draft.reset;
export const isSummaryDirty = (draft: SummaryDraft) => Object.keys(draft.values).length > 0 || draft.reset.size > 0;

const modelValues = (model: ModelConfig | undefined): ModelValues => ({
  name: model?.name ?? "",
  baseUrl: model?.baseUrl ?? NVIDIA_BASE_URL,
  apiKeyEnv: model?.apiKeyEnv ?? "",
});

/** The model as a scope shows it, before edits; `withoutPersonal` shows what applies once the personal model is reset. */
export function shownModel(settings: AgentSettings, scope: SettingsScope, withoutPersonal = false): Shown<ModelValues> {
  if (scope === "personal" && !withoutPersonal) {
    return { value: modelValues(settings.effective.model), source: settings.sources.model, overridden: false };
  }
  const model = settings.shared.model;
  return {
    value: modelValues(model),
    source: model === undefined ? "default" : "shared",
    overridden: scope === "shared" && settings.sources.model === "personal",
  };
}

/** A summaries setting as a scope shows it, before edits. */
export function shownSummary<K extends SummarySettingKey>(
  settings: AgentSettings,
  scope: SettingsScope,
  key: K,
  withoutPersonal = false,
): Shown<(typeof DEFAULT_SUMMARIES)[K]> {
  if (scope === "personal" && !withoutPersonal) {
    return { value: settings.effective.summaries[key], source: settings.sources.summaries[key], overridden: false };
  }
  const value = settings.shared.summaries[key];
  return {
    value: value ?? DEFAULT_SUMMARIES[key],
    source: value === undefined ? "default" : "shared",
    overridden: scope === "shared" && settings.sources.summaries[key] === "personal",
  };
}

/** A chat setting as a scope shows it, before edits. */
export function shownChat(settings: AgentSettings, scope: SettingsScope, key: ChatSettingKey, withoutPersonal = false): Shown<number> {
  if (scope === "personal" && !withoutPersonal) {
    return { value: settings.effective.chat[key], source: settings.sources.chat[key], overridden: false };
  }
  const value = settings.shared.chat[key];
  return {
    value: value ?? DEFAULT_CHAT[key],
    source: value === undefined ? "default" : "shared",
    overridden: scope === "shared" && settings.sources.chat[key] === "personal",
  };
}

export const CHAT_LIMITS: Record<ChatSettingKey, string> = {
  units: "Enter a whole number from 1 to 20.",
  contextTokens: "Enter a whole number from 1,000 to 100,000.",
  historyTurns: "Enter a whole number from 0 to 50.",
  historyTokens: "Enter a whole number from 0 to 100,000.",
  answerTokens: "Enter a whole number from 256 to 32,000.",
};

/** A chat number as typed, or `undefined` when it isn't valid for the setting. */
export function parseChatSetting(key: ChatSettingKey, text: string): number | undefined {
  const trimmed = text.trim().replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return chatSettingSchemas[key].safeParse(value).success ? value : undefined;
}

export function chatErrors(draft: ChatDraft): Partial<Record<ChatSettingKey, string>> {
  const errors: Partial<Record<ChatSettingKey, string>> = {};
  for (const key of CHAT_SETTING_KEYS) {
    const text = draft.values[key];
    if (text !== undefined && parseChatSetting(key, text) === undefined) errors[key] = CHAT_LIMITS[key];
  }
  return errors;
}

/** The chat tab's part of a save, or `undefined` when it has nothing to save. */
export function chatUpdate(scope: SettingsScope, draft: ChatDraft): AgentSettingsUpdate["chat"] | undefined {
  const chat: NonNullable<AgentSettingsUpdate["chat"]> = {};
  if (scope === "personal") for (const key of draft.reset) chat[key] = null;
  for (const key of CHAT_SETTING_KEYS) {
    const text = draft.values[key];
    if (text !== undefined) chat[key] = parseChatSetting(key, text) ?? null;
  }
  return Object.keys(chat).length === 0 ? undefined : chat;
}

function firstIssue(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string | undefined {
  return result.success ? undefined : (result.error?.issues[0]?.message ?? "Invalid value");
}

/** What is wrong with each model field, if anything. */
export function modelErrors(values: ModelValues): Partial<Record<ModelField, string>> {
  const errors: Partial<Record<ModelField, string>> = {};
  if (values.name.trim() === "") errors.name = "Enter the provider's model ID.";
  const url = firstIssue(modelConfigSchema.shape.baseUrl.safeParse(values.baseUrl));
  if (url !== undefined) errors.baseUrl = "Enter an https URL (http only to this machine).";
  const env = firstIssue(modelConfigSchema.shape.apiKeyEnv.safeParse(values.apiKeyEnv));
  if (env !== undefined) errors.apiKeyEnv = "Enter an environment variable name (letters, digits and _).";
  return errors;
}

/** The model configuration for values that pass `modelErrors`. */
export const modelConfigOf = (values: ModelValues): ModelConfig => ({
  provider: "nvidia",
  name: values.name.trim(),
  baseUrl: values.baseUrl.trim(),
  apiKeyEnv: values.apiKeyEnv.trim(),
});

const numberLimits = {
  concurrency: "Enter a whole number from 1 to 16.",
  tokenBudget: "Enter a whole number from 1,000 to 1,000,000.",
} as const;

/** A number as typed, or `undefined` when it isn't valid for the setting. */
export function parseNumberSetting(key: "concurrency" | "tokenBudget", text: string): number | undefined {
  const trimmed = text.trim().replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return summarySettingSchemas[key].safeParse(value).success ? value : undefined;
}

export function summaryErrors(draft: SummaryDraft): Partial<Record<"concurrency" | "tokenBudget", string>> {
  const errors: Partial<Record<"concurrency" | "tokenBudget", string>> = {};
  for (const key of ["concurrency", "tokenBudget"] as const) {
    const text = draft.values[key];
    if (text !== undefined && parseNumberSetting(key, text) === undefined) errors[key] = numberLimits[key];
  }
  return errors;
}

/** The model tab's part of a save to its scope's file, or `undefined` when it has nothing to save. */
export function modelUpdate(scope: SettingsScope, draft: ModelDraft): Pick<AgentSettingsUpdate, "model"> | undefined {
  if (draft.values !== null) return { model: modelConfigOf(draft.values) };
  if (draft.reset && scope === "personal") return { model: null };
  return undefined;
}

/** The summarization tab's part of a save, or `undefined` when it has nothing to save. */
export function summaryUpdate(scope: SettingsScope, draft: SummaryDraft): AgentSettingsUpdate["summaries"] | undefined {
  const summaries: AgentSettingsUpdate["summaries"] = {};
  if (scope === "personal") for (const key of draft.reset) summaries[key] = null;
  for (const key of ["concurrency", "tokenBudget"] as const) {
    const text = draft.values[key];
    if (text !== undefined) summaries[key] = parseNumberSetting(key, text) ?? null;
  }
  if (draft.values.prefill !== undefined) summaries.prefill = draft.values.prefill;
  return Object.keys(summaries).length === 0 ? undefined : summaries;
}

/**
 * The saves the drafts make, at most one per file: the two tabs' changes are combined when both
 * go to the same file.
 */
export function buildUpdates(
  settings: AgentSettings,
  modelScope: SettingsScope,
  modelDraft: ModelDraft,
  summaryScope: SettingsScope,
  summaryDraft: SummaryDraft,
  chatScope: SettingsScope = "personal",
  chatDraft: ChatDraft = emptyChatDraft(),
): AgentSettingsUpdate[] {
  const byScope = new Map<SettingsScope, AgentSettingsUpdate>();
  const forScope = (scope: SettingsScope) => {
    let update = byScope.get(scope);
    if (update === undefined) {
      update = { scope, baseVersion: settings[scope].version, summaries: {} };
      byScope.set(scope, update);
    }
    return update;
  };
  const model = modelUpdate(modelScope, modelDraft);
  if (model !== undefined) Object.assign(forScope(modelScope), model);
  const summaries = summaryUpdate(summaryScope, summaryDraft);
  if (summaries !== undefined) forScope(summaryScope).summaries = summaries;
  const chat = chatUpdate(chatScope, chatDraft);
  if (chat !== undefined) forScope(chatScope).chat = chat;
  return [...byScope.values()];
}

/** Whether a save switches pre-filling on in the shared file, which needs the user's confirmation. */
export function enablesSharedPrefill(settings: AgentSettings, updates: readonly AgentSettingsUpdate[]): boolean {
  return updates.some((update) => update.scope === "shared" && update.summaries?.prefill === true && settings.shared.summaries.prefill !== true);
}
