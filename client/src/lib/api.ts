import { hc } from "hono/client";
import type {
  AgentSettings,
  AgentSettingsUpdate,
  AnchorFolderResult,
  ApiErrorBody,
  ApiRouter,
  CreateOptions,
  DeletePreview,
  FileContent,
  FileView,
  SectionProblemsResult,
  FolderSettings,
  ModelTestResult,
  SectionInfo,
  SectionNotice,
  SectionProblem,
  SectionSearchResult,
  SectionStatusLists,
  SectionSummaryLookup,
  SummaryRequest,
  SummaryResult,
  SummaryStatus,
  Tree,
} from "@specquer/shared/api";
import { type ChatEvent, type ChatRequest, type ChatTurn, chatEventSchema } from "@specquer/shared/chat";
import type { CommentChange, CommentChangeResult, CommentsResponse } from "@specquer/shared/comments";
import type { BodyEdit } from "@specquer/shared/markdown";
import type { AgentApproval, FolderSetting, ModelConfig } from "@specquer/shared/settings";
import type { UiState, UiStatePatch } from "@specquer/shared/uistate";

/**
 * The typed API client (Hono's `hc`, typed from the router in `shared`), wrapped in the
 * operations the UI needs. Everything goes over HTTP to Specquer's own server, so a future
 * desktop shell can host the same UI.
 */

export const client = hc<ApiRouter>("/");

/** Browsers cap the bodies of a page's keepalive requests at 64 KiB in all; this leaves a margin. */
export const KEEPALIVE_LIMIT = 60_000;

/**
 * The room left for keepalive request bodies. Browsers count the bodies of all of a page's
 * keepalive requests in flight together, in bytes, and refuse a request over the cap outright
 * (`fetch` rejects), rather than send it without keepalive. Leaving the page sends the document,
 * the UI state and a comment draft at once, in that order, so they share one budget, measured in
 * UTF-8 bytes of the JSON body. A body that doesn't fit is sent without keepalive: it may not
 * arrive if the page closes, but it isn't certain to fail.
 */
export class KeepaliveBudget {
  private inFlight = 0;

  constructor(private readonly limit = KEEPALIVE_LIMIT) {}

  /** Reserves room for a JSON body; returns its release, or `null` when it doesn't fit. */
  reserve(body: unknown): (() => void) | null {
    const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
    if (this.inFlight + bytes > this.limit) return null;
    this.inFlight += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight -= bytes;
    };
  }
}

const keepaliveBudget = new KeepaliveBudget();

/** Sends a request with keepalive when it is wanted and its body fits the budget. */
async function withKeepalive<T>(wanted: boolean | undefined, body: unknown, send: (keepalive: boolean) => Promise<T>): Promise<T> {
  const release = wanted === true ? keepaliveBudget.reserve(body) : null;
  try {
    return await send(release !== null);
  } finally {
    release?.();
  }
}

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

/**
 * A save's outcome; `edits` are the anchors the server added, relative to the body sent, and
 * `notices` what it changed beyond adding anchors.
 */
export type SaveOutcome =
  | { kind: "saved"; version: string; edits?: BodyEdit[]; notices?: SectionNotice[] }
  | { kind: "conflict"; version: string };

export type CreateOutcome = { kind: "created"; path: string } | { kind: "exists"; message: string };

export type RenameOutcome = { kind: "renamed"; path: string; uiState: UiState } | { kind: "exists"; message: string };

/** A settings save's outcome: saved, changed on disk meanwhile, or a file that isn't valid YAML. */
export type SettingsSaveOutcome = { kind: "saved"; version: string } | { kind: "conflict" } | { kind: "invalid"; message: string };

/** A folder setting's save; once saved, whether the folder is sectioned now. */
export type FolderSaveOutcome = { kind: "saved"; version: string; sectioned: boolean } | { kind: "conflict" } | { kind: "invalid"; message: string };

/** The operations the UI uses; tests substitute their own. */
export interface Api {
  getTree(): Promise<Tree>;
  readFile(path: string): Promise<FileContent>;
  /** A file other than Markdown, to show it (Step 014). */
  readView(path: string): Promise<FileView>;
  saveFile(path: string, text: string, baseVersion: string, options?: { keepalive?: boolean }): Promise<SaveOutcome>;
  create(parent: string, name: string, kind: "file" | "folder", options?: CreateOptions): Promise<CreateOutcome>;
  rename(path: string, newName: string): Promise<RenameOutcome>;
  deletePreview(path: string): Promise<DeletePreview>;
  deleteEntry(path: string): Promise<UiState>;
  getUiState(): Promise<UiState>;
  patchUiState(patch: UiStatePatch, options?: { keepalive?: boolean }): Promise<UiState>;
  getSections(path: string): Promise<SectionInfo[]>;
  searchSections(query: string, options?: { path?: string; limit?: number }): Promise<SectionSearchResult[]>;
  anchorFolder(folder: string, dryRun: boolean, addAgentGuide?: boolean): Promise<AnchorFolderResult>;
  sectionProblems(folder: string): Promise<SectionProblemsResult>;
  /** The status lists for a file's sections. */
  sectionStatuses(path: string): Promise<SectionStatusLists>;
  /** Renumbers one occurrence of a duplicate ID; the edits are relative to the body on disk. */
  renumberSection(path: string, id: string, uid: string | null, baseVersion: string): Promise<SaveOutcome>;
  /** Renumbers every section of a file that is a copy of another document. */
  renumberDocument(path: string, baseVersion: string): Promise<SaveOutcome>;
  summaryStatus(): Promise<SummaryStatus>;
  /** Summarizes a section's saved text; `signal` aborts the request when it is no longer needed. */
  summarize(request: SummaryRequest, signal?: AbortSignal): Promise<SummaryResult>;
  /** A section's summary by ID, from the server's cache only (for link previews and reports). */
  sectionSummary(id: string): Promise<SectionSummaryLookup>;
  agentSettings(): Promise<AgentSettings>;
  saveAgentSettings(update: AgentSettingsUpdate): Promise<SettingsSaveOutcome>;
  /** Approves shared agent settings that wait for this user (a model endpoint, pre-filling). */
  approveAgentSettings(approval: AgentApproval): Promise<void>;
  /** Whether an environment variable is set on the server. */
  envSet(name: string): Promise<boolean>;
  /** One small call to the model with these settings, saved or not. */
  testModel(config: ModelConfig, signal?: AbortSignal): Promise<ModelTestResult>;
  folderSettings(path: string): Promise<FolderSettings>;
  saveFolderSettings(path: string, setting: FolderSetting, baseVersion: string): Promise<FolderSaveOutcome>;
  /**
   * Asks a question; the answer's events stream in (Step 010). Rejects with an `ApiRequestError`
   * (e.g. `503` without a model) before the stream starts. `signal` stops the answer.
   */
  chat(request: ChatRequest, signal?: AbortSignal): Promise<AsyncIterable<ChatEvent>>;
  chatHistory(): Promise<ChatTurn[]>;
  /** Clears the conversation; resolves to the turns cleared, for Undo. */
  clearChatHistory(): Promise<ChatTurn[]>;
  /** Puts cleared turns back; resolves to the conversation. */
  restoreChatHistory(turns: ChatTurn[]): Promise<ChatTurn[]>;
  /** A document's comment threads (Step 012). */
  comments(path: string): Promise<CommentsResponse>;
  /** Applies one change to a document's threads; `keepalive` when the page is closing. */
  changeComments(path: string, change: CommentChange, options?: { keepalive?: boolean }): Promise<CommentChangeResult>;
}

/**
 * Reads a stream of server-sent events into chat events: blocks separated by a blank line,
 * `data:` lines joined, comments (keep-alives) skipped. Each event is checked with its schema; a
 * malformed one is an error, never trusted.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const stop = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
          .join("\n");
        if (data !== "") yield chatEventSchema.parse(JSON.parse(data));
        end = buffer.indexOf("\n\n");
      }
    }
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}

/** A settings save's response: 409 and 422 are outcomes, not errors. */
async function settingsOutcome<T extends { version: string }>(res: JsonResponse): Promise<{ kind: "saved" } & T | { kind: "conflict" } | { kind: "invalid"; message: string }> {
  if (res.status === 409) return { kind: "conflict" };
  if (res.status === 422) return { kind: "invalid", message: ((await res.json()) as ApiErrorBody).message };
  return { kind: "saved", ...(await json<T>(res)) };
}

type SavedBody = { version: string; edits?: BodyEdit[]; notices?: SectionNotice[] };

async function saveOutcome(res: JsonResponse): Promise<SaveOutcome> {
  if (res.status === 409) {
    const body = (await res.json()) as { version: string };
    return { kind: "conflict", version: body.version };
  }
  const body = await json<SavedBody>(res);
  return {
    kind: "saved",
    version: body.version,
    ...(body.edits === undefined ? {} : { edits: body.edits }),
    ...(body.notices === undefined ? {} : { notices: body.notices }),
  };
}

export const httpApi: Api = {
  async getTree() {
    return json<Tree>(await client.api.tree.$get());
  },
  async readFile(path) {
    return json<FileContent>(await client.api.file.$get({ query: { path } }));
  },
  async readView(path) {
    return json<FileView>(await client.api.view.$get({ query: { path } }));
  },
  async saveFile(path, text, baseVersion, options) {
    const body = { text, baseVersion };
    return withKeepalive(options?.keepalive, body, async (keepalive) => saveOutcome(await client.api.file.$put({ query: { path }, json: body }, { init: { keepalive } })));
  },
  async create(parent, name, kind, options = {}) {
    const res = await client.api.create.$post({ json: { parent, name, kind, ...options } });
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
    return withKeepalive(options?.keepalive, patch, async (keepalive) => json<UiState>(await client.api.uistate.$patch({ json: patch }, { init: { keepalive } })));
  },
  async getSections(path) {
    return (await json<{ sections: SectionInfo[] }>(await client.api.sections.$get({ query: { path } }))).sections;
  },
  async searchSections(q, options) {
    const query = { q, ...(options?.path === undefined ? {} : { path: options.path }), ...(options?.limit === undefined ? {} : { limit: String(options.limit) }) };
    return (await json<{ results: SectionSearchResult[] }>(await client.api.sections.search.$get({ query }))).results;
  },
  async anchorFolder(folder, dryRun, addAgentGuide = false) {
    return json<AnchorFolderResult>(await client.api.sections.anchor.$post({ json: { folder, dryRun, addAgentGuide } }));
  },
  async sectionProblems(folder) {
    return json<SectionProblemsResult>(await client.api.sections.problems.$get({ query: { folder } }));
  },
  async sectionStatuses(path) {
    return json<SectionStatusLists>(await client.api.sections.statuses.$get({ query: { path } }));
  },
  async renumberSection(path, id, uid, baseVersion) {
    return saveOutcome(await client.api.sections.renumber.$post({ json: { path, id, uid, baseVersion } }));
  },
  async renumberDocument(path, baseVersion) {
    return saveOutcome(await client.api.sections["renumber-document"].$post({ json: { path, baseVersion } }));
  },
  async summaryStatus() {
    return json<SummaryStatus>(await client.api.summaries.status.$get());
  },
  async summarize(request, signal) {
    return json<SummaryResult>(await client.api.summaries.$post({ json: request }, { init: { signal } }));
  },
  async sectionSummary(id) {
    return json<SectionSummaryLookup>(await client.api.summaries.sections[":id"].$get({ param: { id } }));
  },
  async agentSettings() {
    return json<AgentSettings>(await client.api.settings.agent.$get());
  },
  async saveAgentSettings(update) {
    return settingsOutcome<{ version: string }>(await client.api.settings.agent.$put({ json: update }));
  },
  async approveAgentSettings(approval) {
    await json<{ ok: true }>(await client.api.settings.agent.approve.$post({ json: approval }));
  },
  async envSet(name) {
    return (await json<{ set: boolean }>(await client.api.settings.env.$get({ query: { name } }))).set;
  },
  async testModel(config, signal) {
    return json<ModelTestResult>(await client.api.settings["model-test"].$post({ json: config }, { init: { signal } }));
  },
  async folderSettings(path) {
    return json<FolderSettings>(await client.api.settings.folder.$get({ query: { path } }));
  },
  async saveFolderSettings(path, setting, baseVersion) {
    return settingsOutcome<{ version: string; sectioned: boolean }>(await client.api.settings.folder.$put({ json: { path, setting, baseVersion } }));
  },
  async chat(request, signal) {
    const res = await client.api.chat.$post({ json: request }, { init: { signal } });
    if (!res.ok) throw await failure(res);
    if (res.body === null) throw new ApiRequestError(res.status, "The answer's stream is missing.");
    return readEvents(res.body, signal);
  },
  async chatHistory() {
    return (await json<{ turns: ChatTurn[] }>(await client.api.chat.history.$get())).turns;
  },
  async clearChatHistory() {
    return (await json<{ turns: ChatTurn[] }>(await client.api.chat.history.$delete())).turns;
  },
  async restoreChatHistory(turns) {
    return (await json<{ turns: ChatTurn[] }>(await client.api.chat.history.$put({ json: { turns } }))).turns;
  },
  async comments(path) {
    return json<CommentsResponse>(await client.api.comments.$get({ query: { path } }));
  },
  async changeComments(path, change, options) {
    return withKeepalive(options?.keepalive, change, async (keepalive) =>
      json<CommentChangeResult>(await client.api.comments.$patch({ query: { path }, json: change }, { init: { keepalive } })),
    );
  },
};
