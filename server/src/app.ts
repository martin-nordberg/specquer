import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { type ApiHandlers, createApiRouter } from "@specquer/shared/api";
import { FileService } from "./files.ts";
import { addAgentGuideFile, hasAgentGuideFile } from "./sections/agent-guide.ts";
import { SectionIndex } from "./sections/section-index.ts";
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
import { UiStateStore } from "./uistate-store.ts";

export interface AppConfig extends SecurityConfig {
  root: string;
  development: boolean;
  /** Fetches the bundled client page, which Bun serves from an internal route. */
  fetchPage: () => Promise<Response>;
}

export function createHandlers(files: FileService, uiState: UiStateStore, sections: SectionIndex): ApiHandlers {
  return {
    async getTree() {
      const tree = await files.getTree();
      // Files may have changed outside Specquer; catch up in the background
      sections.scan().catch((err) => console.error(err));
      return tree;
    },
    readFile: (path) => files.readFile(path),
    saveFile: (path, text, baseVersion) => sections.save(path, text, baseVersion),
    async create(parent, name, kind) {
      const path = await sections.create(parent, name, kind);
      return path === null ? { ok: false, reason: "exists" } : { ok: true, path };
    },
    async rename(path, newName) {
      const newPath = await files.rename(path, newName);
      if (newPath === null) return { ok: false, reason: "exists" };
      if (newPath !== path) await sections.renamed(path, newPath);
      return { ok: true, path: newPath, uiState: await uiState.renamed(path, newPath) };
    },
    deletePreview: (path) => files.deletePreview(path),
    async deleteEntry(path) {
      await files.deleteEntry(path);
      await sections.deleted(path);
      return uiState.deleted(path);
    },
    getUiState: () => uiState.load(),
    patchUiState: (patch) => uiState.patch(patch),
    getSections: (path) => sections.sectionsOf(path),
    searchSections: (query, limit, path) => sections.search(query, limit, path),
    async anchorFolder(folder, dryRun, addAgentGuide) {
      const changed = await sections.anchorFolder(folder, dryRun);
      if (!dryRun && addAgentGuide) await addAgentGuideFile(files);
      return { files: changed, agentGuide: await hasAgentGuideFile(files) };
    },
    sectionProblems: (folder) => sections.problems(folder),
    renumberSection: (path, id, uid, baseVersion) => sections.renumber(path, id, uid, baseVersion),
  };
}

const UNAUTHORIZED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Specquer</title></head>
<body style="font-family: sans-serif; margin: 3rem"><h1>Specquer</h1>
<p>This session isn't signed in. Open Specquer with the URL it printed when it started.</p></body></html>`;

/**
 * The Hono app: security checks, the client page with its token exchange, and the API; and the
 * section index, which the caller scans once the server is listening.
 */
export function createApp(config: AppConfig) {
  const files = new FileService(config.root);
  const uiState = new UiStateStore(config.root, (path) => files.kindOf(path));
  const sections = new SectionIndex(files);
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

  app.route("/", createApiRouter(createHandlers(files, uiState, sections)));

  app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "not_found", message: "Not found" }, 404) : c.text("Not found", 404)));
  return { app, sections };
}

