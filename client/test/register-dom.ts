import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Test preload (see bunfig.toml): a browser-like DOM (happy-dom) for the client's component
 * tests. It must be registered before React DOM loads, which checks for a DOM on import.
 *
 * `bun test` runs every package's tests in one process, so Bun's own networking and timer
 * globals are put back afterwards: the server tests need Bun's Request, Response and fetch, and
 * the components don't use them.
 */

const keep = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "Blob",
  "File",
  "URL",
  "AbortController",
  "AbortSignal",
  "TransformStream",
  "WritableStream",
  "WebSocket",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "atob",
  "btoa",
] as const;

const bunGlobals = Object.fromEntries(keep.map((name) => [name, globalThis[name]]));
GlobalRegistrator.register({ url: "http://127.0.0.1:3000/" });
Object.assign(globalThis, bunGlobals);
