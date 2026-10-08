import { join } from "node:path";
import { type AgentConfig, type AgentConfigFile, mergeAgentConfig, parseAgentConfig } from "@specquer/agent";
import { parseDocument } from "yaml";

/**
 * The agent configuration files: `.specquer/shared/agent.config.yaml` and the personal
 * `.specquer/user/agent.config.yaml`, which overrides it. Each is read again when its
 * modification time changes, so editing them takes effect without a restart.
 */

export const SHARED_AGENT_CONFIG = join(".specquer", "shared", "agent.config.yaml");
export const USER_AGENT_CONFIG = join(".specquer", "user", "agent.config.yaml");

class ConfigFile {
  private stamp: number | null = null;
  /** The parse of the file at `stamp`; a promise, so concurrent loads share one read. */
  private parsed: Promise<AgentConfigFile> = Promise.resolve({ summaries: {} });

  constructor(
    private readonly root: string,
    private readonly path: string,
    private readonly warn: (message: string) => void,
  ) {}

  async load(): Promise<AgentConfigFile> {
    const file = Bun.file(join(this.root, this.path));
    let stamp: number | null;
    try {
      stamp = (await file.stat()).mtimeMs;
    } catch {
      stamp = null;
    }
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      this.parsed = stamp === null ? Promise.resolve({ summaries: {} }) : file.text().then((text) => this.parse(text), () => ({ summaries: {} }));
    }
    return this.parsed;
  }

  private parse(text: string): AgentConfigFile {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) {
      this.warn(`${this.path}: ${doc.errors[0]!.message.split("\n")[0]}`);
      return { summaries: {} };
    }
    return parseAgentConfig(doc.toJS(), this.path, this.warn);
  }
}

export class AgentConfigFiles {
  private readonly shared: ConfigFile;
  private readonly user: ConfigFile;

  constructor(root: string, warn: (message: string) => void = (message) => console.warn(`specquer: ${message}`)) {
    this.shared = new ConfigFile(root, SHARED_AGENT_CONFIG, warn);
    this.user = new ConfigFile(root, USER_AGENT_CONFIG, warn);
  }

  async load(): Promise<AgentConfig> {
    const [shared, user] = await Promise.all([this.shared.load(), this.user.load()]);
    return mergeAgentConfig(shared, user);
  }
}
