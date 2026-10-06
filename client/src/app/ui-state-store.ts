import { type UiState, diffUiState } from "@specquer/shared/uistate";
import type { Api } from "@/lib/api";

/** How long changes collect before they are sent to the server. */
export const UI_STATE_SAVE_DELAY = 300;

/**
 * The client's copy of the UI state. Changes apply at once and are sent to the server shortly
 * after, as a patch of the fields that changed (the last write wins across tabs).
 */
export class UiStateStore {
  private state: UiState;
  /** The state the server has. */
  private persisted: UiState;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();

  constructor(
    private readonly api: Api,
    initial: UiState,
  ) {
    this.state = initial;
    this.persisted = initial;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = () => this.state;

  update(change: (state: UiState) => UiState): void {
    const next = change(this.state);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), UI_STATE_SAVE_DELAY);
  }

  /** Sends pending changes now. */
  async flush(options?: { keepalive?: boolean }): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const patch = diffUiState(this.persisted, this.state);
    if (Object.keys(patch).length === 0) return;
    const sent = this.state;
    this.persisted = sent;
    try {
      await this.api.patchUiState(patch, options);
    } catch (err) {
      console.error("Couldn't save the UI state", err);
    }
  }

  /** Replaces the state with the server's (after a rename or delete there). */
  reset(state: UiState): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.state = state;
    this.persisted = state;
    for (const listener of this.listeners) listener();
  }
}
