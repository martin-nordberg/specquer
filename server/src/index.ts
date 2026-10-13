import client from "@specquer/client/index.html";
import type { Database } from "bun:sqlite";
import { createApp } from "./app.ts";
import { CliError, USAGE, parseCli, resolveRoot } from "./cli.ts";
import { acquireInstanceLock, handOver, removeInstanceInfo, writeInstanceInfo } from "./instance.ts";
import { openBrowser } from "./launch.ts";
import { LOOPBACK_HOST, generateToken } from "./security.ts";

/** Without `--port`, Specquer tries this port and falls back to a free one (decision D12). */
const DEFAULT_PORT = 4870;

// `bun --hot` re-runs this module on every change; keep the session token, the instance lock (a
// second attempt from this process would find it taken) and the opened-browser and instance-file
// flags for the life of the process
const processState = globalThis as typeof globalThis & {
  specquerToken?: string;
  specquerOpened?: boolean;
  specquerLock?: Database | null;
  specquerInstanceWritten?: boolean;
};
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

// One Specquer per root folder (Step 009): a second launch hands over to the running instance
if (processState.specquerLock === undefined) {
  const lock = await acquireInstanceLock(root);
  if (lock.kind === "taken") {
    process.exit(
      await handOver(root, lock.info, { open: options.open, portGiven: options.port !== undefined }, {
        print: (line) => console.log(line),
        warn: (line) => console.error(line),
        openBrowser,
      }),
    );
  }
  if (lock.kind === "unavailable") {
    console.error(`Couldn't lock ${root} against a second Specquer (${lock.problem}); starting without the lock.`);
    processState.specquerLock = null;
  } else {
    processState.specquerLock = lock.lock;
    // Left by a run that crashed; a second launch must not read its URL
    removeInstanceInfo(root);
  }
}

const development = process.env.NODE_ENV !== "production";
let port = 0;
const { app, sections, summaries } = createApp({
  root,
  token,
  development,
  port: () => port,
  fetchPage: () => fetch(`http://${LOOPBACK_HOST}:${port}${internalPagePath}`),
  // The end-to-end tests shorten pre-filling's wait
  ...(process.env.SPECQUER_PREFILL_DELAY_MS === undefined ? {} : { summaries: { prefillDelay: Number(process.env.SPECQUER_PREFILL_DELAY_MS) } }),
});

function serve(listenPort: number) {
  return Bun.serve({
    hostname: LOOPBACK_HOST,
    port: listenPort,
    // Documented as the default, but without it a second Specquer can bind the same port and
    // share its connections instead of falling back to a free one
    reusePort: false,
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

// Bring the section index up to date in the background; this writes nothing
sections.scan().catch((err) => console.error(err));
// Delete summaries unused for 60 days (also checked once a day while summarizing), and start
// pre-filling if it is switched on
summaries.purge().catch((err) => console.error(err));
summaries.filesChanged();

const url = `http://${LOOPBACK_HOST}:${port}/?token=${token}`;
console.log(`Specquer is serving ${root}\nOpen ${url}`);
if (processState.specquerLock && !processState.specquerInstanceWritten) {
  processState.specquerInstanceWritten = true;
  const instanceRoot = root;
  await writeInstanceInfo(root, { pid: process.pid, port, url, root, startedAt: new Date().toISOString() }).catch((err) =>
    console.error(`Couldn't write the instance file: ${(err as Error).message}`),
  );
  process.on("exit", () => removeInstanceInfo(instanceRoot, process.pid));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(signal === "SIGINT" ? 130 : 143));
}
if (options.open && !processState.specquerOpened) {
  processState.specquerOpened = true;
  if (!(await openBrowser(url))) console.error("Couldn't open a browser; open the URL above by hand.");
}
