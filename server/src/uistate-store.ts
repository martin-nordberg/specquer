import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type EntryKind,
  type UiState,
  type UiStatePatch,
  applyUiStatePatch,
  defaultUiState,
  deleteInUiState,
  parseUiState,
  pruneMissing,
  renameInUiState,
} from "@specquer/shared/uistate";
import { writeAtomically } from "./files.ts";

/**
 * Persists the UI state in `.specquer/user/uistate.yaml` under the root. If Specquer is open in
 * several tabs, the last write wins. Updates are applied one at a time.
 */
export class UiStateStore {
  readonly folder: string;
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    root: string,
    private readonly kindOf: (path: string) => Promise<EntryKind | undefined>,
  ) {
    this.folder = join(root, ".specquer", "user");
    this.file = join(this.folder, "uistate.yaml");
  }

  /** Reads the state; damaged content falls back to defaults, and vanished files are dropped. */
  async load(): Promise<UiState> {
    return this.prune(await this.read());
  }

  private async read(): Promise<UiState> {
    const file = Bun.file(this.file);
    if (!(await file.exists())) return defaultUiState();
    try {
      return parseUiState(Bun.YAML.parse(await file.text()));
    } catch {
      // Invalid YAML: start from the defaults
      return defaultUiState();
    }
  }

  /** Drops entries for files and folders that no longer exist (for example deleted by an agent). */
  private async prune(state: UiState): Promise<UiState> {
    const paths = new Set([...state.expandedFolders, ...state.recentFiles, ...Object.keys(state.files)]);
    if (state.currentFile !== undefined) paths.add(state.currentFile);
    const kinds = new Map<string, EntryKind | undefined>();
    await Promise.all([...paths].map(async (p) => kinds.set(p, await this.kindOf(p))));
    return pruneMissing(state, (p) => kinds.get(p));
  }

  async save(state: UiState): Promise<void> {
    await this.ensureFolder();
    const header = "# Specquer UI state for this user; written by Specquer\n";
    await writeAtomically(this.file, header + Bun.YAML.stringify(state, null, 2) + "\n");
  }

  /** Creates `.specquer/user/` with a `.gitignore` that keeps per-user state out of Git. */
  private async ensureFolder(): Promise<void> {
    const created = await mkdir(this.folder, { recursive: true });
    // mkdir returns the first folder it created, or undefined if the folder already existed
    if (created === undefined) return;
    const gitignore = Bun.file(join(this.folder, ".gitignore"));
    if (!(await gitignore.exists())) await Bun.write(gitignore, "*\n");
  }

  /**
   * Applies an update to the stored state and returns the result. Pruning comes after the
   * change, so a rename can still find the entries for the old paths.
   */
  update(change: (state: UiState) => UiState): Promise<UiState> {
    const run = this.queue.then(async () => {
      const next = await this.prune(change(await this.read()));
      await this.save(next);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  patch(patch: UiStatePatch): Promise<UiState> {
    return this.update((state) => applyUiStatePatch(state, patch));
  }

  renamed(from: string, to: string): Promise<UiState> {
    return this.update((state) => renameInUiState(state, from, to));
  }

  deleted(path: string): Promise<UiState> {
    return this.update((state) => deleteInUiState(state, path));
  }
}
