import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType } from "zod";
import type { BodyEdit } from "../markdown/sections.ts";
import { type UiState, type UiStatePatch, uiStatePatchSchema } from "../uistate/uistate.ts";
import {
  type AnchorFolderResult,
  type ApiErrorBody,
  type DeletePreview,
  type FileContent,
  type SectionInfo,
  type SectionNotice,
  type SectionProblem,
  type SectionSearchResult,
  type SummaryRequest,
  type SummaryResult,
  type SummaryStatus,
  type Tree,
  anchorFolderSchema,
  createSchema,
  entryQuerySchema,
  fileQuerySchema,
  renameSchema,
  renumberSectionSchema,
  saveFileSchema,
  sectionProblemsSchema,
  sectionSearchSchema,
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

export type RenameResult = { ok: true; path: string; uiState: UiState } | { ok: false; reason: "exists" };

export interface ApiHandlers {
  getTree(): Promise<Tree>;
  readFile(path: string): Promise<FileContent>;
  saveFile(path: string, text: string, baseVersion: string): Promise<SaveResult>;
  create(parent: string, name: string, kind: "file" | "folder"): Promise<CreateResult>;
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
  summaryStatus(): Promise<SummaryStatus>;
  /** Summarizes a section; `signal` aborts when the client no longer needs it. */
  summarize(request: SummaryRequest, signal: AbortSignal): Promise<SummaryResult>;
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
function validate<T extends ZodType, Target extends "json" | "query">(target: Target, schema: T) {
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
      const { parent, name, kind } = c.req.valid("json");
      const result = await handlers.create(parent, name, kind);
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
    .get("/summaries/status", async (c) => c.json(await handlers.summaryStatus()))
    .post("/summaries", validate("json", summaryRequestSchema), async (c) => {
      return c.json(await handlers.summarize(c.req.valid("json"), c.req.raw.signal));
    });
}

export type ApiRouter = ReturnType<typeof createApiRouter>;
