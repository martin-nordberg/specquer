/**
 * The client's preview Web Worker as a script. Bun's HTML bundling doesn't bundle workers, so
 * the server builds it: from source when running from source, and at build time for the release
 * executable (build.ts defines SPECQUER_PREVIEW_WORKER).
 */

declare const SPECQUER_PREVIEW_WORKER: string | undefined;

export const PREVIEW_WORKER_PATH = "/_specquer/preview-worker.js";

let built: Promise<string> | undefined;

export function previewWorkerScript(): Promise<string> {
  if (typeof SPECQUER_PREVIEW_WORKER === "string") return Promise.resolve(SPECQUER_PREVIEW_WORKER);
  built ??= buildPreviewWorker({ minify: false });
  return built;
}

export async function buildPreviewWorker(options: { minify: boolean }): Promise<string> {
  const result = await Bun.build({
    entrypoints: [Bun.resolveSync("@specquer/client/preview-worker", import.meta.dir)],
    target: "browser",
    // Some packages' browser builds use the DOM, which workers don't have; prefer their worker builds
    conditions: ["worker"],
    format: "esm",
    minify: options.minify,
  });
  const output = result.outputs[0];
  if (!result.success || output === undefined) throw new AggregateError(result.logs, "Couldn't build the preview worker");
  return output.text();
}
