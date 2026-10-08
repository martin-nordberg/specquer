/**
 * A fake OpenAI-compatible chat model for the end-to-end tests (decision D9), so they never call
 * a real model and need no key. Each summary is "Summary of <the text's first line>".
 */
export interface FakeModel {
  /** The base URL to configure (`…/v1`). */
  baseUrl: string;
  /** The user prompts received, in order. */
  prompts: string[];
  /** Answer the next `count` requests with 429 (the rate limit). */
  failNext(count: number): void;
  /** Delay each answer by this many milliseconds. */
  delay: number;
  stop(): Promise<void>;
}

/** The key the Specquer process gets, under this variable name. */
export const FAKE_MODEL_KEY_ENV = "SPECQUER_E2E_MODEL_KEY";

export function startFakeModel(): FakeModel {
  let failures = 0;
  const model: FakeModel = {
    baseUrl: "",
    prompts: [],
    failNext: (count) => {
      failures = count;
    },
    delay: 0,
    stop: async () => {
      await server.stop(true);
    },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") return new Response("Not found", { status: 404 });
      const body = (await request.json()) as { model: string; messages: Array<{ role: string; content: string }> };
      const prompt = body.messages.at(-1)?.content ?? "";
      model.prompts.push(prompt);
      if (model.delay > 0) await Bun.sleep(model.delay);
      if (failures > 0) {
        failures--;
        return Response.json({ error: { message: "Rate limit exceeded", type: "rate_limit" } }, { status: 429 });
      }
      const text = prompt.match(/<text>\n([\s\S]*)\n<\/text>/)?.[1] ?? "";
      const firstLine = text.split("\n").find((line) => line.trim() !== "")?.replace(/^#+\s*/, "") ?? "";
      return Response.json({
        id: `chatcmpl-${model.prompts.length}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: `Summary of ${firstLine}.` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    },
  });
  model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  return model;
}

/** The agent configuration pointing at a fake model. */
export function fakeModelConfig(model: FakeModel): string {
  return `model:\n  provider: nvidia\n  name: fake/model\n  baseUrl: ${model.baseUrl}\n  apiKeyEnv: ${FAKE_MODEL_KEY_ENV}\nsummaries:\n  concurrency: 2\n`;
}
