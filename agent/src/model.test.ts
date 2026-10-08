import { expect, test } from "bun:test";
import { ChatOpenAI } from "@langchain/openai";
import { NVIDIA_BASE_URL } from "./config.ts";
import { createChatModel } from "./model.ts";

const config = { provider: "nvidia" as const, name: "google/gemma-4-31b-it", baseUrl: NVIDIA_BASE_URL, apiKeyEnv: "TEST_KEY" };

test("not configured without a model or a key", () => {
  expect(createChatModel(undefined, {})).toMatchObject({ ok: false, problem: expect.stringContaining("agent.config.yaml") });
  expect(createChatModel(config, {})).toMatchObject({ ok: false, problem: expect.stringContaining("TEST_KEY") });
  expect(createChatModel(config, { TEST_KEY: " " }).ok).toBe(false);
});

test("an OpenAI-compatible model at the configured URL", () => {
  const resolved = createChatModel(config, { TEST_KEY: "secret" });
  if (!resolved.ok) throw new Error(resolved.problem);
  expect(resolved.id).toBe("google/gemma-4-31b-it");
  expect(resolved.model).toBeInstanceOf(ChatOpenAI);
  const chat = resolved.model as ChatOpenAI;
  expect(chat.model).toBe("google/gemma-4-31b-it");
  expect(chat.clientConfig.baseURL).toBe(NVIDIA_BASE_URL);
});
