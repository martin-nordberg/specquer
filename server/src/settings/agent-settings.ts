import { join } from "node:path";
import { type AgentConfigFile, mergeAgentConfig, parseAgentConfig } from "@specquer/agent";
import type { AgentConfigFileSettings, AgentSettings, AgentSettingsUpdate, SettingsSaveResult, SummaryStatus } from "@specquer/shared/api";
import { CHAT_SETTING_KEYS, NVIDIA_BASE_URL, SUMMARY_SETTING_KEYS, type SettingsScope, type SettingSource } from "@specquer/shared/settings";
import { type Document, isMap } from "yaml";
import { SHARED_AGENT_CONFIG, USER_AGENT_CONFIG } from "../summaries/config.ts";
import { ensureUserFolder } from "../user-folder.ts";
import { type WriteQueue, YamlFile, type YamlFileContent } from "./yaml-file.ts";

/**
 * The agent configuration as the settings dialog reads and writes it: the shared file
 * (committed) and the personal one (`.specquer/user/`, ignored by Git), which overrides it.
 */

const SHARED_HEADER =
  " The model for agent features (summaries in the preview, the chat). The API key is never written here:\n" +
  " apiKeyEnv names the environment variable that holds it. A personal .specquer/user/agent.config.yaml\n" +
  " overrides this file.";
const PERSONAL_HEADER = " Personal agent settings; they override .specquer/shared/agent.config.yaml. Not committed.";

const MODEL_KEYS = ["provider", "name", "baseUrl", "apiKeyEnv"] as const;

export interface AgentSettingsEnvironment {
  /** Whether an environment variable is set. */
  keySet(name: string): boolean;
  status(): Promise<SummaryStatus>;
}

export class AgentSettingsFiles {
  private readonly files: Record<SettingsScope, YamlFile>;

  constructor(root: string, queue: WriteQueue) {
    this.files = {
      shared: new YamlFile(root, SHARED_AGENT_CONFIG, queue, SHARED_HEADER),
      personal: new YamlFile(root, USER_AGENT_CONFIG, queue, PERSONAL_HEADER, () => ensureUserFolder(join(root, ".specquer", "user"))),
    };
  }

  private static view(content: YamlFileContent, path: string): AgentConfigFileSettings & { parsed: AgentConfigFile } {
    if (content.error !== undefined) return { version: content.version, summaries: {}, chat: {}, warnings: [], error: content.error, parsed: { summaries: {} } };
    const warnings: string[] = [];
    const parsed = parseAgentConfig(content.doc.toJS(), path, (message) => warnings.push(message));
    return {
      version: content.version,
      ...(parsed.model === undefined ? {} : { model: parsed.model }),
      summaries: parsed.summaries,
      chat: parsed.chat ?? {},
      warnings,
      parsed,
    };
  }

  async read(environment: AgentSettingsEnvironment): Promise<AgentSettings> {
    const [sharedContent, personalContent] = await Promise.all([this.files.shared.read(), this.files.personal.read()]);
    const { parsed: shared, ...sharedView } = AgentSettingsFiles.view(sharedContent, SHARED_AGENT_CONFIG);
    const { parsed: personal, ...personalView } = AgentSettingsFiles.view(personalContent, USER_AGENT_CONFIG);
    const effective = mergeAgentConfig(shared, personal);
    const source = (inPersonal: boolean, inShared: boolean): SettingSource => (inPersonal ? "personal" : inShared ? "shared" : "default");
    const summaries = Object.fromEntries(
      SUMMARY_SETTING_KEYS.map((key) => [key, source(personal.summaries[key] !== undefined, shared.summaries[key] !== undefined)]),
    ) as AgentSettings["sources"]["summaries"];
    const chat = Object.fromEntries(
      CHAT_SETTING_KEYS.map((key) => [key, source(personal.chat?.[key] !== undefined, shared.chat?.[key] !== undefined)]),
    ) as AgentSettings["sources"]["chat"];
    const keys: Record<string, boolean> = {};
    for (const model of [shared.model, personal.model]) if (model !== undefined) keys[model.apiKeyEnv] = environment.keySet(model.apiKeyEnv);
    return {
      shared: sharedView,
      personal: personalView,
      effective,
      sources: { model: source(personal.model !== undefined, shared.model !== undefined), summaries, chat },
      keys,
      status: await environment.status(),
    };
  }

  /** Writes the settings named in `update` to one file, keeping everything else in it. */
  write(update: AgentSettingsUpdate): Promise<SettingsSaveResult> {
    return this.files[update.scope].edit(update.baseVersion, (doc) => {
      if (doc.contents !== null && !isMap(doc.contents)) return `${this.files[update.scope].path}: expected a mapping. Fix the file by hand first.`;
      if (update.model === null) {
        if (doc.contents !== null) doc.delete("model");
      }
      else if (update.model !== undefined) {
        // The schema fills in the default URL; the update's type is what callers send
        const model = { ...update.model, baseUrl: update.model.baseUrl ?? NVIDIA_BASE_URL };
        if (!isMap(doc.get("model"))) doc.set("model", doc.createNode({}));
        for (const key of MODEL_KEYS) {
          // The default URL isn't written into a file that leaves it out
          if (key === "baseUrl" && model.baseUrl === NVIDIA_BASE_URL && !doc.hasIn(["model", key])) continue;
          setIfChanged(doc, ["model", key], model[key]);
        }
      }
      writeBlock(doc, "summaries", SUMMARY_SETTING_KEYS, update.summaries ?? {});
      writeBlock(doc, "chat", CHAT_SETTING_KEYS, update.chat ?? {});
    });
  }
}

/** Writes a settings block's values (`null` removes one), and removes the block when it is left empty. */
function writeBlock<K extends string>(doc: Document, block: string, keys: readonly K[], values: Partial<Record<K, string | number | boolean | null | undefined>>): void {
  for (const key of keys) {
    const value = values[key];
    if (value === undefined) continue;
    if (value === null) {
      if (isMap(doc.get(block))) doc.deleteIn([block, key]);
    }
    else {
      if (!isMap(doc.get(block))) doc.set(block, doc.createNode({}));
      setIfChanged(doc, [block, key], value);
    }
  }
  const map = doc.get(block);
  if (isMap(map) && map.items.length === 0) doc.delete(block);
}

/** Sets a value only when it differs, so an unchanged value keeps its quoting and comments. */
function setIfChanged(doc: Document, path: string[], value: string | number | boolean): void {
  if (doc.getIn(path) !== value) doc.setIn(path, value);
}
