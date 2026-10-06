import client from "@specquer/client/index.html";
import { createApp } from "./app.ts";
import { CliError, USAGE, parseCli, resolveRoot } from "./cli.ts";
import { openBrowser } from "./launch.ts";
import { LOOPBACK_HOST, generateToken } from "./security.ts";

/** Without `--port`, Specquer tries this port and falls back to a free one (decision D12). */
const DEFAULT_PORT = 4870;

// `bun --hot` re-runs this module on every change; keep the session token and the
// opened-browser flag for the life of the process
const processState = globalThis as typeof globalThis & { specquerToken?: string; specquerOpened?: boolean };
const token = (processState.specquerToken ??= generateToken());

// The bundled client is served from an internal route; the `/` handler adds the security checks
// and headers, which Bun's HTML routes can't
const internalPagePath = `/_specquer/page-${Bun.hash(token).toString(36)}`;

let options;
let root: string;
try {
  options = parseCli(Bun.argv.slice(2));
  root = await resolveRoot(options.root);
} catch (err) {
  if (!(err instanceof CliError)) throw err;
  console.error(`specquer: ${err.message}\n${USAGE}`);
  process.exit(2);
}

const development = process.env.NODE_ENV !== "production";
let port = 0;
const app = createApp({
  root,
  token,
  development,
  port: () => port,
  fetchPage: () => fetch(`http://${LOOPBACK_HOST}:${port}${internalPagePath}`),
});

function serve(listenPort: number) {
  return Bun.serve({
    hostname: LOOPBACK_HOST,
    port: listenPort,
    development,
    routes: { [internalPagePath]: client },
    fetch: app.fetch,
  });
}

let server;
try {
  server = serve(options.port ?? DEFAULT_PORT);
} catch (err) {
  if (options.port !== undefined || (err as { code?: string }).code !== "EADDRINUSE") throw err;
  server = serve(0);
}
port = server.port ?? 0;

const url = `http://${LOOPBACK_HOST}:${port}/?token=${token}`;
console.log(`Specquer is serving ${root}\nOpen ${url}`);
if (options.open && !processState.specquerOpened) {
  processState.specquerOpened = true;
  if (!(await openBrowser(url))) console.error("Couldn't open a browser; open the URL above by hand.");
}
