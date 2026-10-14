import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType } from "zod";
import { type ChatEvent, type ChatRequest, type ChatTurn, chatRequestSchema, chatRestoreSchema } from "../chat/chat.ts";
import type { BodyEdit } from "../markdown/sections.ts";
import type { FolderSetting, FolderType, ModelConfig } from "../settings/settings.ts";
import { type UiState, type UiStatePatch, uiStatePatchSchema } from "../uistate/uistate.ts";
import {
  type AgentSettings,
  type AgentSettingsUpdate,
  type AnchorFolderResult,
  type ApiErrorBody,
  type DeletePreview,
  type FileContent,
  type FolderSettings,
  type ModelTestResult,
  type SectionInfo,
  type SectionNotice,
  type SectionProblem,
  type SectionSearchResult,
  type SectionSummaryLookup,
  type SettingsSaveResult,
  type SummaryRequest,
  type SummaryResult,
  type SummaryStatus,
  type Tree,
  agentSettingsUpdateSchema,
  anchorFolderSchema,
  createSchema,
  entryQuerySchema,
  envQuerySchema,
  fileQuerySchema,
  folderQuerySchema,
  folderSettingsUpdateSchema,
  modelTestSchema,
  renameSchema,
  renumberDocumentSchema,
  renumberSectionSchema,
  saveFileSchema,
  sectionProblemsSchema,
  sectionSearchSchema,
  sectionSummaryParamSchema,
  summaryRequestSchema,
} from "./schemas.ts";

/**
 * The API, shared by client and server. The router defines every route and its validation; the
 * server supplies the handlers. The client's typed Hono client (`hc`) is typed from `ApiRouter`.
 */

/** An error with an HTTP status, thrown by handlers and turned into a JSON response. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A save's outcome. Saving a sectioned file may add or correct its anchors; `edits` then holds
 * the changes, relative to the body (the text without front matter, with `\n` line endings)
 * that was sent.
 */
export type SaveResult =
  | { ok: true; version: string; edits?: BodyEdit[]; notices?: SectionNotice[] }
  | { ok: false; reason: "conflict"; version: string };

export type CreateResult = { ok: true; path: string } | { ok: false; reason: "exists" };

/** A folder setting's save: on success, also whether the folder is sectioned now. */
export type FolderSettingsSaveResult = { ok: true; version: string; sectioned: boolean } | Extract<SettingsSaveResult, { ok: false }>;

export type RenameResult = { ok: true; path: string; uiState: UiState } | { ok: false; reason: "exists" };

/** A new file's prefix, or a new folder's type and default prefix, when not the inherited ones. */
export interface CreateOptions {
  prefix?: string;
  folderType?: FolderType;
}

export interface ApiHandlers {
  getTree(): Promise<Tree>;
  readFile(path: string): Promise<FileContent>;
  saveFile(path: string, text: string, baseVersion: string): Promise<SaveResult>;
  create(parent: string, name: string, kind: "file" | "folder", options?: CreateOptions): Promise<CreateResult>;
  rename(path: string, newName: string): Promise<RenameResult>;
  deletePreview(path: string): Promise<DeletePreview>;
  deleteEntry(path: string): Promise<UiState>;
  getUiState(): Promise<UiState>;
  patchUiState(patch: UiStatePatch): Promise<UiState>;
  getSections(path: string): Promise<SectionInfo[]>;
  searchSections(query: string, limit: number, path?: string): Promise<SectionSearchResult[]>;
  anchorFolder(folder: string, dryRun: boolean, addAgentGuide: boolean): Promise<AnchorFolderResult>;
  sectionProblems(folder: string): Promise<SectionProblem[]>;
  renumberSection(path: string, id: string, uid: string | null, baseVersion: string): Promise<SaveResult>;
  /** Renumbers every section of a file that is a copy of another document. */
  renumberDocument(path: string, baseVersion: string): Promise<SaveResult>;
  summaryStatus(): Promise<SummaryStatus>;
  /** Summarizes a section; `signal` aborts when the client no longer needs it. */
  summarize(request: SummaryRequest, signal: AbortSignal): Promise<SummaryResult>;
  /** A section's summary by section ID, from the cache only; `404` for an unknown ID. */
  sectionSummary(id: string): Promise<SectionSummaryLookup>;
  agentSettings(): Promise<AgentSettings>;
  saveAgentSettings(update: AgentSettingsUpdate): Promise<SettingsSaveResult>;
  /** Whether an environment variable is set; never its value. */
  envSet(name: string): Promise<boolean>;
  /** One small model call with the settings as entered; `signal` aborts it. */
  testModel(config: ModelConfig, signal: AbortSignal): Promise<ModelTestResult>;
  folderSettings(path: string): Promise<FolderSettings>;
  saveFolderSettings(path: string, setting: FolderSetting, baseVersion: string): Promise<FolderSettingsSaveResult>;
  /**
   * Answers a question as a stream of events (Step 010). Throws `ApiError` (e.g. `503` without a
   * model) before the stream starts; later failures are `error` events. `signal` stops the answer.
   */
  chat(request: ChatRequest, signal: AbortSignal): Promise<AsyncIterable<ChatEvent>>;
  chatHistory(): Promise<ChatTurn[]>;
  /** Clears the conversation; returns the turns cleared, for Undo. */
  clearChatHistory(): Promise<ChatTurn[]>;
  /** Puts cleared turns back in front of any added since; returns the conversation. */
  restoreChatHistory(turns: ChatTurn[]): Promise<ChatTurn[]>;
}

/**
 * While an answer's stream is quiet, a comment goes out this often. Bun closes a started response
 * that sends nothing for its idle timeout (10 seconds by default), and a model can think longer
 * than that before its first words.
 */
export const CHAT_KEEP_ALIVE = 5_000;

/** A failed settings save as a response: a conflict, or a file that isn't valid YAML. */
function settingsFailure(result: Extract<SettingsSaveResult, { ok: false }>) {
  return result.reason === "conflict"
    ? ({ status: 409, body: { error: "conflict", message: "The file changed on disk.", version: result.version } } as const)
    : ({ status: 422, body: { error: "invalid", message: result.message } } as const);
}

/** A successful save's response body: the new version, and the edits and notices if any. */
function saveBody(result: Extract<SaveResult, { ok: true }>) {
  return {
    version: result.version,
    ...(result.edits === undefined ? {} : { edits: result.edits }),
    ...(result.notices === undefined ? {} : { notices: result.notices }),
  };
}

/** Validation errors use the same JSON shape as other errors. */
function validate<T extends ZodType, Target extends "json" | "query" | "param">(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join(" ");
      return c.json({ error: "invalid", message } satisfies ApiErrorBody, 400);
    }
  });
}

export function createApiRouter(handlers: ApiHandlers) {
  return new Hono()
    .basePath("/api")
    .onError((err, c) => {
      if (err instanceof ApiError) {
        return c.json({ error: err.code, message: err.message } satisfies ApiErrorBody, err.status);
      }
      // The client went away (a summary no longer needed): nobody reads the response
      if (c.req.raw.signal.aborted) return c.body(null, 499 as never);
      console.error(err);
      return c.json({ error: "internal", message: "Internal server error" } satisfies ApiErrorBody, 500);
    })
    .get("/tree", async (c) => c.json(await handlers.getTree()))
    .get("/file", validate("query", fileQuerySchema), async (c) => {
      return c.json(await handlers.readFile(c.req.valid("query").path));
    })
    .put("/file", validate("query", fileQuerySchema), validate("json", saveFileSchema), async (c) => {
      const { text, baseVersion } = c.req.valid("json");
      const result = await handlers.saveFile(c.req.valid("query").path, text, baseVersion);
      if (!result.ok) return c.json({ error: "conflict", version: result.version }, 409);
      return c.json(saveBody(result), 200);
    })
    .post("/create", validate("json", createSchema), async (c) => {
      const { parent, name, kind, prefix, folderType } = c.req.valid("json");
      const result = await handlers.create(parent, name, kind, {
        ...(prefix === undefined ? {} : { prefix }),
        ...(folderType === undefined ? {} : { folderType }),
      });
      if (!result.ok) {
        return c.json(
          { error: "exists", message: "A file or folder with that name already exists." } satisfies ApiErrorBody,
          409,
        );
      }
      return c.json({ path: result.path }, 201);
    })
    .post("/rename", validate("json", renameSchema), async (c) => {
      const { path, newName } = c.req.valid("json");
      const result = await handlers.rename(path, newName);
      if (!result.ok) {
        return c.json(
          { error: "exists", message: "A file or folder with that name already exists." } satisfies ApiErrorBody,
          409,
        );
      }
      return c.json({ path: result.path, uiState: result.uiState }, 200);
    })
    .get("/entry/delete-preview", validate("query", entryQuerySchema), async (c) => {
      return c.json(await handlers.deletePreview(c.req.valid("query").path));
    })
    .delete("/entry", validate("query", entryQuerySchema), async (c) => {
      return c.json({ uiState: await handlers.deleteEntry(c.req.valid("query").path) });
    })
    .get("/uistate", async (c) => c.json(await handlers.getUiState()))
    .patch("/uistate", validate("json", uiStatePatchSchema), async (c) => {
      return c.json(await handlers.patchUiState(c.req.valid("json")));
    })
    .get("/sections", validate("query", fileQuerySchema), async (c) => {
      return c.json({ sections: await handlers.getSections(c.req.valid("query").path) });
    })
    .get("/sections/search", validate("query", sectionSearchSchema), async (c) => {
      const { q, limit, path } = c.req.valid("query");
      return c.json({ results: await handlers.searchSections(q, limit, path) });
    })
    .post("/sections/anchor", validate("json", anchorFolderSchema), async (c) => {
      const { folder, dryRun, addAgentGuide } = c.req.valid("json");
      return c.json(await handlers.anchorFolder(folder, dryRun, addAgentGuide));
    })
    .get("/sections/problems", validate("query", sectionProblemsSchema), async (c) => {
      return c.json({ problems: await handlers.sectionProblems(c.req.valid("query").folder) });
    })
    .post("/sections/renumber", validate("json", renumberSectionSchema), async (c) => {
      const { path, id, uid, baseVersion } = c.req.valid("json");
      const result = await handlers.renumberSection(path, id, uid, baseVersion);
      if (!result.ok) return c.json({ error: "conflict", version: result.version }, 409);
      return c.json(saveBody(result), 200);
    })
    .post("/sections/renumber-document", validate("json", renumberDocumentSchema), async (c) => {
      const { path, baseVersion } = c.req.valid("json");
      const result = await handlers.renumberDocument(path, baseVersion);
      if (!result.ok) return c.json({ error: "conflict", version: result.version }, 409);
      return c.json(saveBody(result), 200);
    })
    .get("/summaries/status", async (c) => c.json(await handlers.summaryStatus()))
    .post("/summaries", validate("json", summaryRequestSchema), async (c) => {
      return c.json(await handlers.summarize(c.req.valid("json"), c.req.raw.signal));
    })
    .get("/summaries/sections/:id", validate("param", sectionSummaryParamSchema), async (c) => {
      return c.json(await handlers.sectionSummary(c.req.valid("param").id));
    })
    .get("/settings/agent", async (c) => c.json(await handlers.agentSettings()))
    .put("/settings/agent", validate("json", agentSettingsUpdateSchema), async (c) => {
      const result = await handlers.saveAgentSettings(c.req.valid("json"));
      if (!result.ok) {
        const failure = settingsFailure(result);
        return c.json(failure.body, failure.status);
      }
      return c.json({ version: result.version }, 200);
    })
    .get("/settings/env", validate("query", envQuerySchema), async (c) => {
      return c.json({ set: await handlers.envSet(c.req.valid("query").name) });
    })
    .post("/settings/model-test", validate("json", modelTestSchema), async (c) => {
      return c.json(await handlers.testModel(c.req.valid("json"), c.req.raw.signal));
    })
    .get("/settings/folder", validate("query", folderQuerySchema), async (c) => {
      return c.json(await handlers.folderSettings(c.req.valid("query").path));
    })
    .put("/settings/folder", validate("json", folderSettingsUpdateSchema), async (c) => {
      const { path, setting, baseVersion } = c.req.valid("json");
      const result = await handlers.saveFolderSettings(path, setting, baseVersion);
      if (!result.ok) {
        const failure = settingsFailure(result);
        return c.json(failure.body, failure.status);
      }
      return c.json({ version: result.version, sectioned: result.sectioned }, 200);
    })
    .post("/chat", validate("json", chatRequestSchema), async (c) => {
      const signal = c.req.raw.signal;
      const events = await handlers.chat(c.req.valid("json"), signal);
      // The one streaming route: server-sent events, each a JSON `ChatEvent` named by its type
      return streamSSE(c, async (stream) => {
        const keepAlive = setInterval(() => void stream.write(": keep-alive\n\n").catch(() => undefined), CHAT_KEEP_ALIVE);
        try {
          // After a stop the handler still runs to its end (it keeps the stopped answer); nothing more is sent
          for await (const event of events) {
            if (!signal.aborted && !stream.aborted) await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          }
        } finally {
          clearInterval(keepAlive);
        }
      });
    })
    .get("/chat/history", async (c) => c.json({ turns: await handlers.chatHistory() }))
    .delete("/chat/history", async (c) => c.json({ turns: await handlers.clearChatHistory() }))
    .put("/chat/history", validate("json", chatRestoreSchema), async (c) => {
      return c.json({ turns: await handlers.restoreChatHistory(c.req.valid("json").turns) });
    });
}

export type ApiRouter = ReturnType<typeof createApiRouter>;
