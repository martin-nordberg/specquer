import { join } from "node:path";
import type { AgentConfigFile } from "@specquer/agent";
import { type AgentApproval, type ModelEndpoint, type PendingApproval, isDefaultEndpoint, modelEndpointSchema, sameEndpoint } from "@specquer/shared/settings";
import { parse, stringify } from "yaml";
import { writeAtomically } from "../files.ts";
import { ensureUserFolder } from "../user-folder.ts";
import { WriteQueue } from "./yaml-file.ts";

/**
 * Shared agent settings this user has approved, in `.specquer/user/approvals.yaml` (per user,
 * ignored by Git). The shared `agent.config.yaml` is committed, so a change that arrives through
 * Git could send any environment variable to any server, or switch on pre-filling, which sends
 * every spec. Its model endpoint (other than the default) and its `summaries.prefill: true` take
 * effect only once approved here: in the settings dialog, or by saving them there.
 */

export const APPROVALS_FILE = join(".specquer", "user", "approvals.yaml");

const HEADER = "# Shared agent settings this user approved; written by Specquer. Not committed.\n";

export interface Approved {
  models: ModelEndpoint[];
  prefill: boolean;
}

/** What the shared file sets that is in effect but not approved: the personal file overrides it. */
export function pendingApproval(shared: AgentConfigFile, personal: AgentConfigFile, approved: Approved): PendingApproval {
  const model = personal.model === undefined ? shared.model : undefined;
  const endpoint = model === undefined ? undefined : { baseUrl: model.baseUrl, apiKeyEnv: model.apiKeyEnv };
  const modelPending = endpoint !== undefined && !isDefaultEndpoint(endpoint) && !approved.models.some((m) => sameEndpoint(m, endpoint));
  const prefill = personal.summaries.prefill === undefined && shared.summaries.prefill === true && !approved.prefill;
  return { ...(modelPending ? { model: endpoint } : {}), prefill };
}

/** The problem shown while the shared model waits for approval. */
export function approvalProblem(endpoint: ModelEndpoint): string {
  return `The shared agent.config.yaml sends the key in ${endpoint.apiKeyEnv} to ${endpoint.baseUrl}, which you haven't approved. Review it in Settings.`;
}

export function parseApprovals(text: string): Approved {
  let value: unknown;
  try {
    value = parse(text);
  } catch {
    return { models: [], prefill: false };
  }
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const models = Array.isArray(record.models) ? record.models.flatMap((m) => {
    const parsed = modelEndpointSchema.safeParse(m);
    return parsed.success ? [parsed.data] : [];
  }) : [];
  return { models, prefill: record.prefill === true };
}

export class ApprovalsFile {
  private readonly file: string;
  private readonly folder: string;
  private readonly queue = new WriteQueue();
  /** `undefined`: not read yet, or invalidated. */
  private stamp: number | null | undefined = undefined;
  /** The approvals at `stamp`; a promise, so concurrent loads share one read. */
  private approved: Promise<Approved> = Promise.resolve({ models: [], prefill: false });

  constructor(root: string) {
    this.file = join(root, APPROVALS_FILE);
    this.folder = join(root, ".specquer", "user");
  }

  /** The approvals, read again when the file's modification time changes. */
  async load(): Promise<Approved> {
    const file = Bun.file(this.file);
    let stamp: number | null;
    try {
      stamp = (await file.stat()).mtimeMs;
    } catch {
      stamp = null;
    }
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      this.approved = stamp === null ? Promise.resolve({ models: [], prefill: false }) : file.text().then(parseApprovals, () => ({ models: [], prefill: false }));
    }
    return this.approved;
  }

  /** Records approvals; an endpoint already approved isn't added twice. */
  approve(approval: AgentApproval): Promise<void> {
    return this.queue.run(async () => {
      this.stamp = undefined;
      const current = await this.load();
      const models = [...current.models];
      if (approval.model !== undefined && !models.some((m) => sameEndpoint(m, approval.model!))) models.push(approval.model);
      const prefill = current.prefill || approval.prefill === true;
      if (models.length === current.models.length && prefill === current.prefill) return;
      await ensureUserFolder(this.folder);
      await writeAtomically(this.file, HEADER + stringify({ models, prefill }));
      // A write within the same millisecond as the last leaves the modification time unchanged
      this.stamp = undefined;
    });
  }
}
