import { z } from "zod";
import { entryNameSchema, entryPathSchema, markdownPathSchema, workspacePathSchema } from "../paths/paths.ts";
import { SECTION_ID_PATTERN } from "../sections/ids.ts";
import {
  type ChatConfig,
  type ChatSettingKey,
  chatSettingSchemas,
  type FolderSetting,
  type FolderType,
  type ModelConfig,
  type SettingSource,
  type SummariesConfig,
  type SummarySettingKey,
  apiKeyEnvSchema,
  folderSettingSchema,
  folderTypeSchema,
  modelConfigSchema,
  prefixSchema,
  summarySettingSchemas,
} from "../settings/settings.ts";
import { MAX_SUMMARY_TEXT } from "../summaries/rules.ts";

/** A folder in the tree; it lists only folders that contain Markdown files, and `.md` files. */
export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

export interface TreeFile {
  kind: "file";
  name: string;
  path: string;
}

export type TreeNode = TreeFolder | TreeFile;

export interface Tree {
  root: TreeFolder;
  /** True when the folder held more files than the tree's size limit. */
  truncated: boolean;
}

export interface FileContent {
  path: string;
  text: string;
  /** A hash of the file's content; saves send it back to detect changes made on disk. */
  version: string;
}

export interface DeletePreview {
  path: string;
  kind: "file" | "folder";
  /** Every file that would be deleted, including files the tree doesn't show (up to a limit). */
  files: string[];
  /** Total number of files, which may exceed `files.length`. */
  fileCount: number;
  /**
   * Files not committed to Git (new, modified or ignored), or `null` when the root folder isn't
   * in a Git repository.
   */
  uncommitted: string[] | null;
}

/** A section of a document, for badge tooltips and link completion. */
export interface SectionInfo {
  id: string;
  /** The section's UID (its anchor's `data-uid`); `null` when it has none yet or is renumbered on the next save. */
  uid: string | null;
  kind: "root" | "heading" | "item";
  /** The heading text, the start of a list item's text, or the file name for a root section. */
  title: string;
  /** The heading level, for heading sections. */
  depth?: number;
  /** Set when the section's ID is also used elsewhere and the user hasn't decided yet. */
  problem?: {
    kind: "duplicate" | "collision";
    /** Whether this occurrence keeps the ID while the others wait. */
    keeps: boolean;
    /** The other occurrences. */
    others: Array<{ path: string; title: string }>;
  };
}

/** Why a save gave a section a new number. */
/** `prefix-requested`: `<a id="XYZ-?">` over an existing anchor asked for a new ID in another prefix. */
export type SectionRenumberReason = "copy" | "reused" | "unknown-prefix" | "duplicate" | "collision" | "prefix-requested";

/** What a save changed beyond adding anchors, so the user can be told. */
export type SectionNotice =
  /** A copy, a reused retired ID, an unknown prefix, or a duplicate the user asked to renumber. */
  | { kind: "renumbered"; reason: SectionRenumberReason; id: string; newId: string; title: string }
  /** An edited ID: `id` was found, `newId` (the recorded ID) put back. */
  | { kind: "restored"; id: string; newId: string; title: string }
  /** A UID copied from another section was replaced. */
  | { kind: "uid-replaced"; id: string; title: string }
  /**
   * Saved as sent, without anchoring: the file holds merge conflict markers, or (`copied-document`)
   * it and another file hold one document ID and the original isn't known.
   */
  | { kind: "not-anchored"; reason?: "copied-document" };

/** Something about the section anchors that needs the user's attention. */
export type SectionProblem =
  | {
      kind: "duplicate" | "collision";
      id: string;
      occurrences: Array<{ path: string; uid: string | null; title: string; keeps: boolean }>;
    }
  /** An anchor with a section ID that isn't in a section's place. */
  | { kind: "stray"; path: string; id: string; line: number }
  /** A sectioned file with merge conflict markers, left alone until they are resolved. */
  | { kind: "conflict-markers"; path: string }
  /** Files holding one document ID (a whole file copied) with no known original, left alone until the user renumbers the copy. */
  | { kind: "copied-document"; paths: string[] }
  /** A folder below the root with a `.specquer` folder of its own, whose section data is ignored. */
  | { kind: "nested-specquer"; folder: string }
  /** A section whose own status (`data-status`) is blank or not allowed for its prefix; `line` is counted in the body. */
  | { kind: "invalid-status"; path: string; id: string; line: number; value: string; prefix: string }
  /** A prefix's `prefix.config.yaml` that can't be used: the prefix uses the default statuses. */
  | PrefixConfigProblem
  /** A comment sidecar that can't be used: its threads aren't shown or written (Step 012). */
  | { kind: "comment-sidecar"; path: string; problem: SidecarProblem; message: string }
  /** A comment sidecar with no document beside it. */
  | { kind: "orphaned-sidecar"; path: string }
  /** A thread whose section isn't in the saved document; `path` is the document's. */
  | { kind: "detached-thread"; path: string; threadUid: string; sectionUid: string; text: string };

/** Why a comment sidecar can't be used. */
export type SidecarProblem = "unparsable" | "conflict-markers" | "format" | "unknown-status" | "repeated-uid";

/** A prefix's `prefix.config.yaml` that can't be used, and why. */
export interface PrefixConfigProblem {
  kind: "prefix-config";
  prefix: string;
  /** The file's workspace path. */
  path: string;
  problem: "unparsable" | "missing-list" | "empty-list" | "bad-value" | "repeated-value";
  /** What is wrong, for people. */
  message: string;
}

/** The status lists for the sections of a file. */
export interface SectionStatusLists {
  /** Whether the file is sectioned; a file that isn't has no statuses. */
  sectioned: boolean;
  /** The folder's default prefix, for a root section without an ID; `null` when the file isn't sectioned. */
  folderPrefix: string | null;
  /** The allowed statuses of each prefix with a usable `prefix.config.yaml`; other prefixes use the defaults. */
  statusValues: Record<string, string[]>;
}

export interface SectionSearchResult extends SectionInfo {
  /** The document's workspace path. */
  path: string;
}

export interface AnchorFolderResult {
  /** The sectioned files whose anchors change (or would, in a dry run). */
  files: string[];
  /** Whether the root folder's `AGENTS.md` holds the section anchor rules for coding agents. */
  agentGuide: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

export const fileQuerySchema = z.object({ path: markdownPathSchema });

export const entryQuerySchema = z.object({ path: entryPathSchema });

export const saveFileSchema = z.object({
  text: z.string(),
  /** The version the edits were based on. */
  baseVersion: z.string(),
});

export const createSchema = z.object({
  /** The folder to create the entry in ("" for the root folder). */
  parent: workspacePathSchema,
  /** The new entry's name (not a path); a file's must end with `.md`. */
  name: entryNameSchema,
  kind: z.enum(["file", "folder"]),
  /** A new file's prefix, or a new folder's default prefix, when not the inherited one. */
  prefix: prefixSchema.optional(),
  /** A new folder's type, when not the inherited one. */
  folderType: folderTypeSchema.optional(),
});

export const renameSchema = z.object({
  path: entryPathSchema,
  /** The new name (not a path); a file must keep its extension. */
  newName: entryNameSchema,
});

/** Searching sections by ID or title, across documents or (with `path`) in one. */
export const sectionSearchSchema = z.object({
  q: z.string().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  path: markdownPathSchema.optional(),
});

export const sectionProblemsSchema = z.object({
  /** The folder ("" for the root folder). */
  folder: workspacePathSchema.default(""),
});

export const renumberSectionSchema = z.object({
  path: markdownPathSchema,
  /** The occurrence to renumber: its section ID and UID (`null` for none). */
  id: z.string().max(100),
  uid: z.string().max(100).nullable(),
  /** The version the user saw. */
  baseVersion: z.string(),
});

/** Renumbering a whole file as a copy of another document. */
export const renumberDocumentSchema = z.object({
  path: markdownPathSchema,
  /** The version the user saw. */
  baseVersion: z.string(),
});

export const anchorFolderSchema = z.object({
  /** The folder ("" for the root folder). */
  folder: workspacePathSchema,
  /** Only report the files that would change. */
  dryRun: z.boolean(),
  /** Also add the section anchor rules for coding agents to the root folder's `AGENTS.md`. */
  addAgentGuide: z.boolean().default(false),
});

/** Whether summaries can be made: a model is configured and its key is set. */
export interface SummaryStatus {
  enabled: boolean;
  /** The configured model's ID. */
  model?: string;
  /** Why summaries aren't enabled, for the slider's hint. */
  problem?: string;
  /** Background pre-filling: whether it is switched on (and can run), and how many calls wait. */
  prefill?: { enabled: boolean; pending: number };
}

/**
 * A section to summarize: its saved text (the server simplifies it), the document it is in, and
 * the titles of the headings above it, outermost first.
 */
export const summaryRequestSchema = z.object({
  path: markdownPathSchema,
  text: z.string().max(MAX_SUMMARY_TEXT),
  headings: z.array(z.string().max(1000)).max(6).default([]),
  /**
   * `"any"` accepts a cached summary from another model or prompt version at once (marked not
   * `current`); `"current"`, the default, only the configured model's.
   */
  accept: z.enum(["current", "any"]).optional(),
});
export type SummaryRequest = z.infer<typeof summaryRequestSchema>;

export interface SummaryResult {
  summary: string;
  /** The model that made it. */
  model: string;
  /** Whether it came from the cache. */
  cached: boolean;
  /** Whether the text was too long and was cut before it was summarized. */
  truncated: boolean;
  /** Whether it is the configured model's, with the current prompt; false for an older summary. */
  current: boolean;
}

/** The section ID in `GET /api/summaries/sections/:id`. */
export const sectionSummaryParamSchema = z.object({ id: z.string().regex(SECTION_ID_PATTERN, "Not a section ID.") });

/**
 * A section's summary from the cache, never from a model call: a short section or a list item
 * as written, a cached summary, or none yet.
 */
export type SectionSummaryLookup =
  | { kind: "text"; text: string }
  | { kind: "summary"; summary: string; model: string; truncated: boolean; current: boolean }
  | { kind: "none" };

/** One agent configuration file, as the settings dialog sees it. */
export interface AgentConfigFileSettings {
  /** The file's version, sent back when saving; `""` while the file doesn't exist. */
  version: string;
  /** The model it sets, if it sets a valid one. */
  model?: ModelConfig;
  /** The summaries settings it sets (the valid ones). */
  summaries: Partial<SummariesConfig>;
  /** The chat settings it sets (the valid ones). */
  chat: Partial<ChatConfig>;
  /** Values in the file ignored as invalid. */
  warnings: string[];
  /** Set when the file isn't valid YAML: it can't be saved until it is fixed by hand. */
  error?: string;
}

/** `GET /api/settings/agent`: both files, the settings in effect and where each comes from. */
export interface AgentSettings {
  shared: AgentConfigFileSettings;
  personal: AgentConfigFileSettings;
  effective: { model?: ModelConfig; summaries: SummariesConfig; chat: ChatConfig };
  sources: { model: SettingSource; summaries: Record<SummarySettingKey, SettingSource>; chat: Record<ChatSettingKey, SettingSource> };
  /** Whether the environment variable each file names in `apiKeyEnv` is set (never its value). */
  keys: Record<string, boolean>;
  status: SummaryStatus;
}

/**
 * Saving agent settings to one file. An absent setting is left as it is; `null` removes it from
 * the file, so the shared value or the default applies.
 */
export const agentSettingsUpdateSchema = z.object({
  scope: z.enum(["shared", "personal"]),
  baseVersion: z.string(),
  model: modelConfigSchema.nullable().optional(),
  summaries: z
    .object({
      concurrency: summarySettingSchemas.concurrency.nullable().optional(),
      tokenBudget: summarySettingSchemas.tokenBudget.nullable().optional(),
      prefill: summarySettingSchemas.prefill.nullable().optional(),
    })
    .default({}),
  chat: z
    .object({
      units: chatSettingSchemas.units.nullable().optional(),
      contextTokens: chatSettingSchemas.contextTokens.nullable().optional(),
      historyTurns: chatSettingSchemas.historyTurns.nullable().optional(),
      historyTokens: chatSettingSchemas.historyTokens.nullable().optional(),
      answerTokens: chatSettingSchemas.answerTokens.nullable().optional(),
    })
    .default({}),
});
/** What a caller sends: the blocks may be left out. */
export type AgentSettingsUpdate = z.input<typeof agentSettingsUpdateSchema>;

/** A settings save's outcome: the new version, a conflict (changed on disk), or a file that isn't valid YAML. */
export type SettingsSaveResult =
  | { ok: true; version: string }
  | { ok: false; reason: "conflict"; version: string }
  | { ok: false; reason: "invalid"; message: string };

/** `GET /api/settings/env?name=`: whether a variable is set. */
export const envQuerySchema = z.object({ name: apiKeyEnvSchema });

/** `POST /api/settings/model-test`: the model settings as entered, saved or not. */
export const modelTestSchema = modelConfigSchema;

export type ModelTestResult = { ok: true; ms: number } | { ok: false; problem: string };

export const folderQuerySchema = z.object({
  /** The folder ("" for the root folder). */
  path: workspacePathSchema,
});

/** A value a folder inherits, and the folder above that sets it (`""` for the root folder). */
export interface InheritedValue<T> {
  /** `null` when no folder above sets it. */
  value: T | null;
  from: string | null;
}

/** `GET /api/settings/folder`: a folder's own `.specquer-config.yaml` and what it inherits. */
export interface FolderSettings {
  path: string;
  /** The folder's file's version, sent back when saving; `""` while it doesn't exist. */
  version: string;
  /** The folder's own settings. */
  own: FolderSetting;
  /** What the folder inherits from the folders above it. */
  inherited: { folderType: InheritedValue<FolderType>; defaultPrefix: InheritedValue<string> };
  /** Set when the file isn't valid YAML: it can't be saved until it is fixed by hand. */
  error?: string;
}

export const folderSettingsUpdateSchema = z.object({
  path: workspacePathSchema,
  setting: folderSettingSchema,
  baseVersion: z.string(),
});
