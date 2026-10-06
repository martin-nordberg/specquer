import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

export const USAGE = "Usage: specquer [root] [--port <n>] [--no-open]";

export interface CliOptions {
  /** The root folder as given (absolute or relative to the working directory). */
  root: string;
  /** A fixed port; without one, Specquer tries its default port and falls back to a free one. */
  port?: number;
  open: boolean;
}

export class CliError extends Error {}

/** Parses the command line (the arguments after the script or executable). */
export function parseCli(args: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      allowNegative: true,
      options: {
        port: { type: "string" },
        open: { type: "boolean", default: true },
      },
    });
  } catch (err) {
    throw new CliError((err as Error).message);
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new CliError("Only one root folder can be given.");
  let port: number | undefined;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!/^\d+$/.test(values.port) || port < 1 || port > 65535) {
      throw new CliError(`Invalid port '${values.port}'.`);
    }
  }
  return { root: positionals[0] ?? ".", port, open: values.open ?? true };
}

/** Resolves the root folder to its real path, failing if it doesn't exist or isn't a folder. */
export async function resolveRoot(root: string, cwd = process.cwd()): Promise<string> {
  const absolute = resolve(cwd, root);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    throw new CliError(`The folder '${absolute}' doesn't exist.`);
  }
  if (!(await stat(real)).isDirectory()) throw new CliError(`'${absolute}' isn't a folder.`);
  return real;
}
