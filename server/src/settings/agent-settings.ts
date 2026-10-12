import { join } from "node:path";
import { type AgentConfigFile, mergeAgentConfig, parseAgentConfig } from "@specquer/agent";
import type { AgentConfigFileSettings, AgentSettings, AgentSettingsUpdate, SettingsSaveResult, SummaryStatus } from "@specquer/shared/api";
import { NVIDIA_BASE_URL, SUMMARY_SETTING_KEYS, type SettingsScope, type SettingSource } from "@specquer/shared/settings";
import { type Document, isMap } from "yaml";
import { SHARED_AGENT_CONFIG, USER_AGENT_CONFIG } from "../summaries/config.ts";
import { ensureUserFolder } from "../user-folder.ts";
import { type WriteQueue, YamlFile, type YamlFileContent } from "./yaml-file.ts";

/**
 * The agent configuration as the settings dialog reads and writes it: the shared file
 * (committed) and the personal one (`.specquer/user/`, ignored by Git), which overrides it.
 */

const SHARED_HEADER =
  " The model for agent features (summaries in the preview). The API key is never written here:\n" +
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
    if (content.error !== undefined) return { version: content.version, summaries: {}, warnings: [], error: content.error, parsed: { summaries: {} } };
    const warnings: string[] = [];
    const parsed = parseAgentConfig(content.doc.toJS(), path, (message) => warnings.push(message));
    return {
      version: content.version,
      ...(parsed.model === undefined ? {} : { model: parsed.model }),
      summaries: parsed.summaries,
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
    const keys: Record<string, boolean> = {};
    for (const model of [shared.model, personal.model]) if (model !== undefined) keys[model.apiKeyEnv] = environment.keySet(model.apiKeyEnv);
    return {
      shared: sharedView,
      personal: personalView,
      effective,
      sources: { model: source(personal.model !== undefined, shared.model !== undefined), summaries },
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
        const model = update.model;
        if (!isMap(doc.get("model"))) doc.set("model", doc.createNode({}));
        for (const key of MODEL_KEYS) {
          // The default URL isn't written into a file that leaves it out
          if (key === "baseUrl" && model.baseUrl === NVIDIA_BASE_URL && !doc.hasIn(["model", key])) continue;
          setIfChanged(doc, ["model", key], model[key]);
        }
      }
      for (const key of SUMMARY_SETTING_KEYS) {
        const value = update.summaries[key];
        if (value === undefined) continue;
        if (value === null) {
          if (isMap(doc.get("summaries"))) doc.deleteIn(["summaries", key]);
        }
        else {
          if (!isMap(doc.get("summaries"))) doc.set("summaries", doc.createNode({}));
          setIfChanged(doc, ["summaries", key], value);
        }
      }
      const summaries = doc.get("summaries");
      if (isMap(summaries) && summaries.items.length === 0) doc.delete("summaries");
    });
  }
}

/** Sets a value only when it differs, so an unchanged value keeps its quoting and comments. */
function setIfChanged(doc: Document, path: string[], value: string | number | boolean): void {
  if (doc.getIn(path) !== value) doc.setIn(path, value);
}
