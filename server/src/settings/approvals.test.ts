import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfigFile } from "@specquer/agent";
import { NVIDIA_BASE_URL, isAllowedModelUrl } from "@specquer/shared/settings";
import { APPROVALS_FILE, ApprovalsFile, parseApprovals, pendingApproval } from "./approvals.ts";

const model = (baseUrl: string, apiKeyEnv: string) => ({ provider: "nvidia" as const, name: "m", baseUrl, apiKeyEnv });
const file = (overrides: Partial<AgentConfigFile> = {}): AgentConfigFile => ({ summaries: {}, ...overrides });
const NONE = { models: [], prefill: false };

describe("pendingApproval", () => {
  test("the default endpoint needs no approval", () => {
    expect(pendingApproval(file({ model: model(NVIDIA_BASE_URL, "NVIDIA_API_KEY") }), file(), NONE)).toEqual({ prefill: false });
  });

  test("another URL or another variable in the shared file waits for approval", () => {
    const evil = { baseUrl: "https://attacker.example/v1", apiKeyEnv: "GITHUB_TOKEN" };
    expect(pendingApproval(file({ model: model(evil.baseUrl, evil.apiKeyEnv) }), file(), NONE)).toEqual({ model: evil, prefill: false });
    const otherKey = { baseUrl: NVIDIA_BASE_URL, apiKeyEnv: "AWS_SECRET_ACCESS_KEY" };
    expect(pendingApproval(file({ model: model(otherKey.baseUrl, otherKey.apiKeyEnv) }), file(), NONE).model).toEqual(otherKey);
    expect(pendingApproval(file({ model: model(evil.baseUrl, evil.apiKeyEnv) }), file(), { models: [evil], prefill: false })).toEqual({ prefill: false });
  });

  test("an approval covers that URL with that variable only", () => {
    const approved = { models: [{ baseUrl: "https://a.example/v1", apiKeyEnv: "A_KEY" }], prefill: false };
    expect(pendingApproval(file({ model: model("https://a.example/v1", "B_KEY") }), file(), approved).model).toBeDefined();
    expect(pendingApproval(file({ model: model("https://b.example/v1", "A_KEY") }), file(), approved).model).toBeDefined();
  });

  test("the personal file's model is the user's own and needs no approval", () => {
    const personal = file({ model: model("https://mine.example/v1", "MY_KEY") });
    expect(pendingApproval(file({ model: model("https://attacker.example/v1", "X") }), personal, NONE)).toEqual({ prefill: false });
  });

  test("shared pre-filling waits for approval unless the personal file sets it", () => {
    const shared = file({ summaries: { prefill: true } });
    expect(pendingApproval(shared, file(), NONE).prefill).toBe(true);
    expect(pendingApproval(shared, file(), { models: [], prefill: true }).prefill).toBe(false);
    expect(pendingApproval(shared, file({ summaries: { prefill: false } }), NONE).prefill).toBe(false);
    expect(pendingApproval(file({ summaries: { prefill: false } }), file(), NONE).prefill).toBe(false);
  });
});

describe("isAllowedModelUrl", () => {
  test("https anywhere, http to this machine only", () => {
    expect(isAllowedModelUrl("https://integrate.api.nvidia.com/v1")).toBe(true);
    expect(isAllowedModelUrl("http://127.0.0.1:8000/v1")).toBe(true);
    expect(isAllowedModelUrl("http://localhost:11434/v1")).toBe(true);
    expect(isAllowedModelUrl("http://[::1]:8000/v1")).toBe(true);
    expect(isAllowedModelUrl("http://example.com/v1")).toBe(false);
    expect(isAllowedModelUrl("http://127.0.0.1.attacker.example/v1")).toBe(false);
    expect(isAllowedModelUrl("ftp://127.0.0.1/")).toBe(false);
  });
});

describe("ApprovalsFile", () => {
  test("records approvals once each, and reads them back", async () => {
    const root = await mkdtemp(join(tmpdir(), "specquer-approvals-"));
    try {
      const approvals = new ApprovalsFile(root);
      expect(await approvals.load()).toEqual(NONE);
      const endpoint = { baseUrl: "https://a.example/v1", apiKeyEnv: "A_KEY" };
      await approvals.approve({ model: endpoint });
      await approvals.approve({ model: endpoint, prefill: true });
      expect(await approvals.load()).toEqual({ models: [endpoint], prefill: true });
      expect(await new ApprovalsFile(root).load()).toEqual({ models: [endpoint], prefill: true });
      expect(await Bun.file(join(root, ".specquer/user/.gitignore")).text()).toBe("*\n");
      expect(await Bun.file(join(root, APPROVALS_FILE)).text()).toStartWith("# Shared agent settings this user approved");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("damaged content approves nothing", () => {
    expect(parseApprovals(": not yaml : [")).toEqual(NONE);
    expect(parseApprovals("models:\n  - baseUrl: https://a.example\n    apiKeyEnv: not a name\nprefill: yes\n")).toEqual(NONE);
  });
});
