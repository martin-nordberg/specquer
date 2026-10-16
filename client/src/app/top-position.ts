import type { TopPosition } from "@specquer/shared/markdown";

/** A report of where the file pane's top is, and when it came. */
export interface TopReport {
  position: TopPosition;
  at: number;
}

/**
 * Where the file pane's top is, as the views report it while they scroll (Step 016, R6). Kept
 * apart from the App's state, so a scroll re-renders only the Outline, not the whole workspace.
 */
export class TopPositionStore {
  private report: TopReport | null = null;
  private readonly listeners = new Set<() => void>();

  set(position: TopPosition, at = performance.now()): void {
    this.report = { position, at };
    for (const listener of this.listeners) listener();
  }

  clear(): void {
    if (this.report === null) return;
    this.report = null;
    for (const listener of this.listeners) listener();
  }

  get = (): TopReport | null => this.report;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
