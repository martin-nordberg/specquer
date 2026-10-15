import { join } from "node:path";
import { type AgentConfig, type AgentConfigFile, mergeAgentConfig, parseAgentConfig } from "@specquer/agent";
import type { PendingApproval } from "@specquer/shared/settings";
import { parseDocument } from "yaml";
import { ApprovalsFile, pendingApproval } from "../settings/approvals.ts";

/**
 * The agent configuration files: `.specquer/shared/agent.config.yaml` and the personal
 * `.specquer/user/agent.config.yaml`, which overrides it. Each is read again when its
 * modification time changes, so editing them takes effect without a restart. Shared settings
 * waiting for this user's approval (`approvals.ts`) are reported, and a shared `prefill: true`
 * waiting for it is off.
 */

export const SHARED_AGENT_CONFIG = join(".specquer", "shared", "agent.config.yaml");
export const USER_AGENT_CONFIG = join(".specquer", "user", "agent.config.yaml");

class ConfigFile {
  /** `undefined`: not read yet, or invalidated. */
  private stamp: number | null | undefined = undefined;
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

  invalidate(): void {
    this.stamp = undefined;
  }
}

export class AgentConfigFiles {
  readonly approvals: ApprovalsFile;
  private readonly shared: ConfigFile;
  private readonly user: ConfigFile;

  constructor(root: string, warn: (message: string) => void = (message) => console.warn(`specquer: ${message}`)) {
    this.shared = new ConfigFile(root, SHARED_AGENT_CONFIG, warn);
    this.user = new ConfigFile(root, USER_AGENT_CONFIG, warn);
    this.approvals = new ApprovalsFile(root);
  }

  async load(): Promise<{ config: AgentConfig; pending: PendingApproval }> {
    const [shared, user, approved] = await Promise.all([this.shared.load(), this.user.load(), this.approvals.load()]);
    const config = mergeAgentConfig(shared, user);
    const pending = pendingApproval(shared, user, approved);
    if (pending.prefill) config.summaries = { ...config.summaries, prefill: false };
    return { config, pending };
  }

  /**
   * Reads both files again on the next load, after Specquer wrote one: a write within the same
   * millisecond as the last one leaves the modification time unchanged.
   */
  invalidate(): void {
    this.shared.invalidate();
    this.user.invalidate();
  }
}
