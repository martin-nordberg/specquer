/**
 * A fake OpenAI-compatible chat model for the end-to-end tests (decision D9), so they never call
 * a real model and need no key. Each summary is "Summary of <the text's first line>". A chat
 * question (a prompt holding `<source`) is answered, streamed in chunks when asked (`stream: true`),
 * with "The answer is in the specs [1]." (Step 010).
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
  /** Delay each streamed chunk by this many milliseconds, so a test can stop an answer. */
  chunkDelay: number;
  /** The chat answer, streamed a few words at a time. */
  chatAnswer: string;
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
    chunkDelay: 0,
    chatAnswer: "The answer is in the specs [1].",
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
      // ChatOpenAI may send more fields with streaming requests (stream_options and others); unknown ones are ignored
      const body = (await request.json()) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        stream?: boolean;
        stream_options?: { include_usage?: boolean };
      };
      const prompt = body.messages.at(-1)?.content ?? "";
      model.prompts.push(prompt);
      if (model.delay > 0) await Bun.sleep(model.delay);
      if (failures > 0) {
        failures--;
        return Response.json({ error: { message: "Rate limit exceeded", type: "rate_limit" } }, { status: 429 });
      }
      if (prompt.includes("<source") || prompt.includes("No sources were found")) return chatAnswer(body, model);
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

/** A chat answer: one completion, or OpenAI-style `data:` chunks of a few words, then `[DONE]`. */
function chatAnswer(body: { model: string; stream?: boolean; stream_options?: { include_usage?: boolean } }, model: FakeModel): Response {
  const id = `chatcmpl-${model.prompts.length}`;
  const created = Math.floor(Date.now() / 1000);
  if (body.stream !== true) {
    return Response.json({
      id,
      object: "chat.completion",
      created,
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: model.chatAnswer }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  }
  const words = model.chatAnswer.split(/(?<= )/);
  const pieces: string[] = [];
  for (let i = 0; i < words.length; i += 2) pieces.push(words.slice(i, i + 2).join(""));
  const chunk = (delta: Record<string, string>, finish: string | null) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(chunk({ role: "assistant", content: "" }, null)));
        for (const piece of pieces) {
          if (model.chunkDelay > 0) await Bun.sleep(model.chunkDelay);
          controller.enqueue(encoder.encode(chunk({ content: piece }, null)));
        }
        controller.enqueue(encoder.encode(chunk({}, "stop")));
        if (body.stream_options?.include_usage === true) {
          const usage = { id, object: "chat.completion.chunk", created, model: body.model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(usage)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        // The client went away (a stopped answer)
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

/** The agent configuration pointing at a fake model. */
export function fakeModelConfig(model: FakeModel): string {
  return `model:\n  provider: nvidia\n  name: fake/model\n  baseUrl: ${model.baseUrl}\n  apiKeyEnv: ${FAKE_MODEL_KEY_ENV}\nsummaries:\n  concurrency: 2\n`;
}
