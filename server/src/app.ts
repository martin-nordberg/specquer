import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { type ApiHandlers, createApiRouter } from "@specquer/shared/api";
import { ChatService, type ChatServiceOptions } from "./chat/service.ts";
import { FileService } from "./files.ts";
import { ModelRuntime } from "./model-runtime.ts";
import { addAgentGuideFile, hasAgentGuideFile } from "./sections/agent-guide.ts";
import { SectionIndex } from "./sections/section-index.ts";
import { AgentSettingsFiles } from "./settings/agent-settings.ts";
import { FolderSettingsFile } from "./settings/folder-settings.ts";
import { WriteQueue } from "./settings/yaml-file.ts";
import { PREVIEW_WORKER_PATH, previewWorkerScript } from "./preview-worker.ts";
import {
  type SecurityConfig,
  apiGuard,
  authentication,
  contentSecurityPolicy,
  hostCheck,
  inlineScriptHashes,
  sessionCookieName,
  tokenMatches,
} from "./security.ts";
import { SummaryService, type SummaryServiceOptions } from "./summaries/service.ts";
import { UiStateStore } from "./uistate-store.ts";

export interface AppConfig extends SecurityConfig {
  root: string;
  development: boolean;
  /** Fetches the bundled client page, which Bun serves from an internal route. */
  fetchPage: () => Promise<Response>;
  /** Overrides for the summary service and the model runtime (tests use a fake model). */
  summaries?: SummaryServiceOptions;
  /** Overrides for document chat. */
  chat?: ChatServiceOptions;
}

export function createHandlers(
  files: FileService,
  uiState: UiStateStore,
  sections: SectionIndex,
  summaries: SummaryService,
  chat: ChatService,
): ApiHandlers {
  // Pre-filling and the chat's search index catch up after files change
  const filesChanged = () => {
    summaries.filesChanged();
    chat.filesChanged();
  };
  // The settings files, written one at a time
  const settingsQueue = new WriteQueue();
  const agentSettings = new AgentSettingsFiles(files.root, settingsQueue);
  const folderSettings = new FolderSettingsFile(files, settingsQueue);
  return {
    async getTree() {
      const tree = await files.getTree();
      // Files may have changed outside Specquer; catch up in the background. Pre-filling skips
      // files that haven't changed
      sections.scan().catch((err) => console.error(err));
      filesChanged();
      return tree;
    },
    readFile: (path) => files.readFile(path),
    async saveFile(path, text, baseVersion) {
      const result = await sections.save(path, text, baseVersion);
      if (result.ok) filesChanged();
      return result;
    },
    async create(parent, name, kind, options = {}) {
      const path = await sections.create(parent, name, kind, kind === "file" ? options.prefix : undefined);
      if (path === null) return { ok: false, reason: "exists" };
      if (kind === "folder" && (options.folderType !== undefined || options.prefix !== undefined)) {
        // A new folder's own file, only for values that differ from the inherited ones
        const setting = { folderType: options.folderType ?? "inherit", defaultPrefix: options.prefix ?? "inherit" } as const;
        const result = await folderSettings.write(path, setting, "");
        if (result.ok) sections.configChanged();
      }
      filesChanged();
      return { ok: true, path };
    },
    async rename(path, newName) {
      const newPath = await files.rename(path, newName);
      if (newPath === null) return { ok: false, reason: "exists" };
      if (newPath !== path) await sections.renamed(path, newPath);
      filesChanged();
      return { ok: true, path: newPath, uiState: await uiState.renamed(path, newPath) };
    },
    deletePreview: (path) => files.deletePreview(path),
    async deleteEntry(path) {
      await files.deleteEntry(path);
      await sections.deleted(path);
      filesChanged();
      return uiState.deleted(path);
    },
    getUiState: () => uiState.load(),
    patchUiState: (patch) => uiState.patch(patch),
    getSections: (path) => sections.sectionsOf(path),
    searchSections: (query, limit, path) => sections.search(query, limit, path),
    async anchorFolder(folder, dryRun, addAgentGuide) {
      const changed = await sections.anchorFolder(folder, dryRun);
      if (!dryRun && addAgentGuide) await addAgentGuideFile(files);
      if (!dryRun && changed.length > 0) filesChanged();
      return { files: changed, agentGuide: await hasAgentGuideFile(files) };
    },
    sectionProblems: (folder) => sections.problems(folder),
    sectionStatuses: (path) => sections.statuses(path),
    renumberSection: (path, id, uid, baseVersion) => sections.renumber(path, id, uid, baseVersion),
    renumberDocument: (path, baseVersion) => sections.renumberDocument(path, baseVersion),
    summaryStatus: () => summaries.status(),
    summarize: (request, signal) => summaries.summarize(request, signal),
    sectionSummary: (id) => summaries.sectionSummary(id),
    agentSettings: () => agentSettings.read({ keySet: (name) => summaries.keySet(name), status: () => summaries.status() }),
    async saveAgentSettings(update) {
      const result = await agentSettings.write(update);
      if (result.ok) summaries.configChanged();
      return result;
    },
    envSet: async (name) => summaries.keySet(name),
    testModel: (config, signal) => summaries.testModel(config, signal),
    chat: (request, signal) => chat.ask(request, signal),
    chatHistory: () => chat.history.read(),
    clearChatHistory: () => chat.history.clear(),
    restoreChatHistory: (turns) => chat.history.restore(turns),
    async folderSettings(path) {
      await files.assertFolder(path);
      return folderSettings.read(path);
    },
    async saveFolderSettings(path, setting, baseVersion) {
      await files.assertFolder(path);
      const result = await folderSettings.write(path, setting, baseVersion);
      if (!result.ok) return result;
      // Sections of files that stopped being sectioned are retired, and come back when they are again
      sections.configChanged();
      await sections.scan();
      filesChanged();
      return { ...result, sectioned: FolderSettingsFile.isSectioned(await folderSettings.read(path)) };
    },
  };
}

const UNAUTHORIZED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Specquer</title></head>
<body style="font-family: sans-serif; margin: 3rem"><h1>Specquer</h1>
<p>This session isn't signed in. Open Specquer with the URL it printed when it started.</p></body></html>`;

/**
 * The Hono app: security checks, the client page with its token exchange, and the API; and the
 * section index, which the caller scans once the server is listening, the summary service,
 * whose unused summaries the caller purges and whose pre-filling it starts, and document chat,
 * whose search index the caller starts building.
 */
export function createApp(config: AppConfig) {
  const files = new FileService(config.root);
  const uiState = new UiStateStore(config.root, (path) => files.kindOf(path));
  const sections = new SectionIndex(files);
  const runtime = new ModelRuntime(config.root, config.summaries);
  const summaries = new SummaryService(config.root, { files, sections }, { ...config.summaries, runtime });
  const chat = new ChatService(config.root, runtime, { files, sections }, config.chat);
  const app = new Hono();

  app.use(hostCheck(config));
  app.use("/api/*", apiGuard(config));

  app.get("/", async (c) => {
    // The launch URL carries the token; exchange it for a cookie and drop it from the address bar
    const token = c.req.query("token");
    if (token !== undefined) {
      if (!tokenMatches(token, config.token)) return c.html(UNAUTHORIZED_PAGE, 401);
      setCookie(c, sessionCookieName(config.port()), config.token, {
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
      });
      return c.redirect("/", 303);
    }
    if (authentication(c, config) === undefined) return c.html(UNAUTHORIZED_PAGE, 401);

    const page = await config.fetchPage();
    const html = await page.text();
    const csp = contentSecurityPolicy({
      port: config.port(),
      development: config.development,
      scriptHashes: inlineScriptHashes(html),
    });
    return c.html(html, 200, {
      "Content-Security-Policy": csp,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
  });

  // Public client code, like the rest of the bundle
  app.get(PREVIEW_WORKER_PATH, async (c) =>
    c.body(await previewWorkerScript(), 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": config.development ? "no-store" : "no-cache",
    }),
  );

  app.route("/", createApiRouter(createHandlers(files, uiState, sections, summaries, chat)));

  app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "not_found", message: "Not found" }, 404) : c.text("Not found", 404)));
  return { app, sections, summaries, chat };
}

