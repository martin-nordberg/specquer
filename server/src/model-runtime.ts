import { type AgentConfig, type ResolvedModel, createChatModel } from "@specquer/agent";
import type { AgentApproval, PendingApproval } from "@specquer/shared/settings";
import { approvalProblem } from "./settings/approvals.ts";
import { AgentConfigFiles } from "./summaries/config.ts";
import { CallQueue } from "./summaries/queue.ts";

/**
 * What the agent features share (Step 010, decision D1): the agent configuration (read again when
 * it changes), the model it names (resolved again when the configuration or the key changes), and
 * the call queue, so `summaries.concurrency` limits summaries and chat together, and with them the
 * calls to the provider. Chat answers get their own model object, the same model with the longer
 * output limit `chat.answerTokens`. A shared model whose endpoint waits for this user's approval
 * isn't used: nothing is sent until it is approved.
 */

export interface ModelRuntimeOptions {
  /** Where API keys come from: the server's environment. */
  env?: Record<string, string | undefined>;
  createModel?: typeof createChatModel;
  warn?: (message: string) => void;
}

export class ModelRuntime {
  readonly queue: CallQueue;
  readonly env: Record<string, string | undefined>;
  readonly createModel: typeof createChatModel;
  private readonly config: AgentConfigFiles;
  private concurrencySetting = 2;
  private resolved: { signature: string; model: ResolvedModel } | null = null;
  private resolvedChat: { signature: string; model: ResolvedModel } | null = null;

  constructor(root: string, options: ModelRuntimeOptions = {}) {
    this.env = options.env ?? process.env;
    this.createModel = options.createModel ?? createChatModel;
    this.config = new AgentConfigFiles(root, options.warn ?? ((message: string) => console.warn(`specquer: ${message}`)));
    this.queue = new CallQueue(() => this.concurrencySetting);
  }

  /** Model calls at once (`summaries.concurrency`), as last read. */
  get concurrency(): number {
    return this.concurrencySetting;
  }

  /** The configuration in effect, its model, the model for chat answers, and what waits for approval. */
  async current(): Promise<{ config: AgentConfig; model: ResolvedModel; chatModel: ResolvedModel; pending: PendingApproval }> {
    const { config, pending } = await this.config.load();
    this.concurrencySetting = config.summaries.concurrency;
    if (pending.model !== undefined) {
      const blocked: ResolvedModel = { ok: false, problem: approvalProblem(pending.model) };
      return { config, model: blocked, chatModel: blocked, pending };
    }
    const key = config.model === undefined ? undefined : this.env[config.model.apiKeyEnv];
    const signature = JSON.stringify([config.model, key]);
    if (this.resolved?.signature !== signature) this.resolved = { signature, model: this.createModel(config.model, this.env) };
    const chatSignature = JSON.stringify([config.model, key, config.chat.answerTokens]);
    if (this.resolvedChat?.signature !== chatSignature) {
      this.resolvedChat = { signature: chatSignature, model: this.createModel(config.model, this.env, { maxTokens: config.chat.answerTokens }) };
    }
    return { config, model: this.resolved.model, chatModel: this.resolvedChat.model, pending };
  }

  /** Records shared settings this user approves; they take effect on the next call. */
  approve(approval: AgentApproval): Promise<void> {
    return this.config.approvals.approve(approval);
  }

  /** Whether an environment variable is set (for the settings dialog; never its value). */
  keySet(name: string): boolean {
    const value = this.env[name];
    return value !== undefined && value.trim() !== "";
  }

  /** Reads the agent configuration again on the next call, after Specquer wrote it. */
  configChanged(): void {
    this.config.invalidate();
  }
}
