import { hc } from "hono/client";
import type { ApiErrorBody, ApiRouter, DeletePreview, FileContent, Tree } from "@specquer/shared/api";
import type { UiState, UiStatePatch } from "@specquer/shared/uistate";

/**
 * The typed API client (Hono's `hc`, typed from the router in `shared`), wrapped in the
 * operations the UI needs. Everything goes over HTTP to Specquer's own server, so a future
 * desktop shell can host the same UI.
 */

export const client = hc<ApiRouter>("/");

/** Browsers cap keepalive request bodies at 64 KiB. */
const KEEPALIVE_LIMIT = 60_000;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The parts of a response the helpers use (Hono's typed responses and fetch's both fit). */
interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

async function failure(res: JsonResponse): Promise<ApiRequestError> {
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // Not JSON
  }
  return new ApiRequestError(res.status, message);
}

async function json<T>(res: JsonResponse): Promise<T> {
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

export type SaveOutcome = { kind: "saved"; version: string } | { kind: "conflict"; version: string };

export type CreateOutcome = { kind: "created"; path: string } | { kind: "exists"; message: string };

export type RenameOutcome = { kind: "renamed"; path: string; uiState: UiState } | { kind: "exists"; message: string };

/** The operations the UI uses; tests substitute their own. */
export interface Api {
  getTree(): Promise<Tree>;
  readFile(path: string): Promise<FileContent>;
  saveFile(path: string, text: string, baseVersion: string, options?: { keepalive?: boolean }): Promise<SaveOutcome>;
  create(parent: string, name: string, kind: "file" | "folder"): Promise<CreateOutcome>;
  rename(path: string, newName: string): Promise<RenameOutcome>;
  deletePreview(path: string): Promise<DeletePreview>;
  deleteEntry(path: string): Promise<UiState>;
  getUiState(): Promise<UiState>;
  patchUiState(patch: UiStatePatch, options?: { keepalive?: boolean }): Promise<UiState>;
}

export const httpApi: Api = {
  async getTree() {
    return json<Tree>(await client.api.tree.$get());
  },
  async readFile(path) {
    return json<FileContent>(await client.api.file.$get({ query: { path } }));
  },
  async saveFile(path, text, baseVersion, options) {
    const keepalive = options?.keepalive === true && text.length < KEEPALIVE_LIMIT;
    const res = await client.api.file.$put({ query: { path }, json: { text, baseVersion } }, { init: { keepalive } });
    if (res.status === 409) {
      const body = (await res.json()) as { version: string };
      return { kind: "conflict", version: body.version };
    }
    const body = await json<{ version: string }>(res);
    return { kind: "saved", version: body.version };
  },
  async create(parent, name, kind) {
    const res = await client.api.create.$post({ json: { parent, name, kind } });
    if (res.status === 409) {
      const body = (await res.json()) as ApiErrorBody;
      return { kind: "exists", message: body.message };
    }
    const body = await json<{ path: string }>(res);
    return { kind: "created", path: body.path };
  },
  async rename(path, newName) {
    const res = await client.api.rename.$post({ json: { path, newName } });
    if (res.status === 409) {
      const body = (await res.json()) as ApiErrorBody;
      return { kind: "exists", message: body.message };
    }
    const body = await json<{ path: string; uiState: UiState }>(res);
    return { kind: "renamed", ...body };
  },
  async deletePreview(path) {
    return json<DeletePreview>(await client.api.entry["delete-preview"].$get({ query: { path } }));
  },
  async deleteEntry(path) {
    return (await json<{ uiState: UiState }>(await client.api.entry.$delete({ query: { path } }))).uiState;
  },
  async getUiState() {
    return json<UiState>(await client.api.uistate.$get());
  },
  async patchUiState(patch, options) {
    return json<UiState>(await client.api.uistate.$patch({ json: patch }, { init: { keepalive: options?.keepalive === true } }));
  },
};
