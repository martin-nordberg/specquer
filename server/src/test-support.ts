import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { $ } from "bun";
import { createApp } from "./app.ts";
import type { ChatServiceOptions } from "./chat/service.ts";
import type { CommentServiceOptions } from "./comments/comment-service.ts";
import type { SummaryServiceOptions } from "./summaries/service.ts";
import { sessionCookieName } from "./security.ts";

/** Helpers for server tests: a temporary root folder with fixture files and a test client. */

export const TEST_PORT = 4999;
export const TEST_TOKEN = "test-token-0123456789";
export const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

export async function tempRoot(files: Record<string, string> = {}, options: { git?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "specquer-test-")));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await Bun.write(join(root, path), text);
  }
  if (options.git) {
    await $`git -C ${root} init -q && git -C ${root} add -A && git -C ${root} -c user.email=t@t -c user.name=t commit -qm init --allow-empty`.quiet();
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export function testApp(
  root: string,
  page = "<!doctype html><script>inline()</script>",
  summaries: SummaryServiceOptions = { env: {} },
  // A question updates the chat's index itself; no background update after a test is over
  chat: ChatServiceOptions = { indexDelay: 3_600_000 },
  // A fixed name, so tests don't depend on the Git configuration of the machine
  comments: CommentServiceOptions = { userName: async () => "Tester" },
) {
  const { app, sections, summaries: summaryService, chat: chatService } = createApp({
    root,
    token: TEST_TOKEN,
    port: () => TEST_PORT,
    development: false,
    fetchPage: async () => new Response(page),
    summaries,
    chat,
    comments,
  });
  const cookie = `${sessionCookieName(TEST_PORT)}=${TEST_TOKEN}`;
  /** A request as the signed-in browser would send it. */
  const request = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: {
        host: `127.0.0.1:${TEST_PORT}`,
        cookie,
        ...(init.method && init.method !== "GET" ? { origin: ORIGIN } : {}),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  return { app, sections, summaries: summaryService, chat: chatService, request };
}
