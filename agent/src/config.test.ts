import { expect, test } from "bun:test";
import { DEFAULT_CHAT, DEFAULT_SUMMARIES, NVIDIA_BASE_URL, mergeAgentConfig, parseAgentConfig } from "./config.ts";

const model = { provider: "nvidia", name: "google/gemma-4-31b-it", apiKeyEnv: "NVIDIA_API_KEY" };

test("parses a configuration, with defaults", () => {
  const parsed = parseAgentConfig({ model, summaries: { concurrency: 3 }, unknown: 1 }, "shared");
  expect(parsed).toEqual({ model: { ...model, provider: "nvidia", baseUrl: NVIDIA_BASE_URL }, summaries: { concurrency: 3 } });
  expect(mergeAgentConfig(parsed, { summaries: {} }).summaries).toEqual({ ...DEFAULT_SUMMARIES, concurrency: 3 });
});

test("invalid values are reported and ignored on their own", () => {
  const warnings: string[] = [];
  const parsed = parseAgentConfig(
    { model: { ...model, provider: "openai" }, summaries: { concurrency: 0, tokenBudget: 5000 } },
    "shared",
    (message) => warnings.push(message),
  );
  expect(parsed).toEqual({ summaries: { tokenBudget: 5000 } });
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toContain("ignoring 'model'");
  expect(warnings[1]).toContain("summaries.concurrency");
  expect(parseAgentConfig({ model: { ...model, apiKeyEnv: "not a name" } }, "s").model).toBeUndefined();
  expect(parseAgentConfig("text", "s", (m) => warnings.push(m))).toEqual({ summaries: {} });
  expect(parseAgentConfig(null, "s")).toEqual({ summaries: {} });
});

test("the personal file replaces the model as a whole and overrides settings key by key", () => {
  const shared = parseAgentConfig({ model, summaries: { concurrency: 4, tokenBudget: 9000 } }, "shared");
  const user = parseAgentConfig({ model: { provider: "nvidia", name: "other/model", apiKeyEnv: "MY_KEY", baseUrl: "http://127.0.0.1:9999/v1" }, summaries: { concurrency: 1, prefill: true } }, "user");
  expect(mergeAgentConfig(shared, user)).toEqual({
    model: { provider: "nvidia", name: "other/model", apiKeyEnv: "MY_KEY", baseUrl: "http://127.0.0.1:9999/v1" },
    summaries: { concurrency: 1, tokenBudget: 9000, prefill: true },
    chat: DEFAULT_CHAT,
  });
  expect(DEFAULT_SUMMARIES.prefill).toBe(false);
  expect(parseAgentConfig({ summaries: { prefill: "yes" } }, "s").summaries).toEqual({});
  expect(mergeAgentConfig({ summaries: {} }, { summaries: {} })).toEqual({ summaries: DEFAULT_SUMMARIES, chat: DEFAULT_CHAT });
});

test("chat settings: parsed key by key, merged with defaults, the personal file winning", () => {
  const warnings: string[] = [];
  const shared = parseAgentConfig({ chat: { units: 5, contextTokens: 500, historyTurns: 3 } }, "shared", (m) => warnings.push(m));
  expect(shared.chat).toEqual({ units: 5, historyTurns: 3 });
  expect(warnings).toEqual([expect.stringContaining("chat.contextTokens")]);
  const user = parseAgentConfig({ chat: { historyTurns: 0 } }, "user");
  expect(mergeAgentConfig(shared, user).chat).toEqual({ ...DEFAULT_CHAT, units: 5, historyTurns: 0 });
  expect(parseAgentConfig({ chat: "x" }, "s", (m) => warnings.push(m)).chat).toBeUndefined();
  expect(warnings.at(-1)).toContain("'chat' must be a mapping");
  expect(parseAgentConfig({ summaries: {} }, "s")).toEqual({ summaries: {} });
});
