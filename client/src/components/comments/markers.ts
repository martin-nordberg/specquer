import type { CommentFilter } from "@specquer/shared/comments";

/**
 * What the three views show of the open document's comment threads (Step 012, R5, R6): a pip on
 * each section with threads the filter shows, the highlighted and flashing sections, and what the
 * pips and the badge menus do.
 */
export interface CommentMarkers {
  /** The number of each section's own threads the filter shows, by section UID. */
  counts: ReadonlyMap<string, number>;
  /** The first line of each of those threads, for the pip's tooltip. */
  previews: ReadonlyMap<string, readonly string[]>;
  /** Sections with threads of any status, for **Show comments**. */
  withThreads: ReadonlySet<string>;
  filter: CommentFilter;
  /** The highlighted sections: one section's UID and its subsections' (R6.1), or `null`. */
  highlight: readonly string[] | null;
  /** Sections to flash (R6.4); `n` changes with each flash. */
  flash: { uids: readonly string[]; n: number } | null;
  /** Whether the file can have threads; the badge menus offer comments only then. */
  available: boolean;
  /** Why **Add comment…** is disabled for every section (an unusable sidecar), if it is. */
  addDisabled?: string;
  onPip: (sectionUid: string) => void;
  onPipHover: (sectionUid: string | null) => void;
  onAddComment: (sectionUid: string) => void;
}

/** Why **Add comment…** is disabled on a section without a UID yet (R2.11). */
export const NO_UID_REASON = "Save the file first: this section gets its ID when it is saved.";

/** The pip's accessible name (R5.8): "2 open comment threads", with those of hidden sections. */
export function pipLabel(count: number, filter: CommentFilter, hidden = 0): string {
  const kind = filter === "open" ? "open " : filter === "resolved" ? "resolved " : "";
  const label = `${count} ${kind}comment ${count === 1 ? "thread" : "threads"}`;
  return hidden === 0 ? label : `${label}, ${hidden} in hidden sections`;
}

/** The pip's text: the count, and those in hidden sections ("3 (2 hidden)", R5.6). */
export function pipText(count: number, hidden = 0): string {
  return hidden === 0 ? String(count) : `${count} (${hidden} hidden)`;
}

/** The flash's class; it alternates, so a second flash of the same section starts again. */
export function flashClass(flash: { n: number }): string {
  return `comment-flash-${flash.n % 2}`;
}

/** The pip's speech bubble, the Comments icon's shape. */
export const BUBBLE_PATH = "M12 4c5 0 9 3.1 9 7s-4 7-9 7c-1.2 0-2.4-.2-3.4-.5L3 20l1.6-4C3.6 14.7 3 12.9 3 11c0-3.9 4-7 9-7z";

function bubbleElement(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linejoin": "round", "aria-hidden": "true" })) {
    svg.setAttribute(name, value);
  }
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", BUBBLE_PATH);
  svg.append(path);
  return svg;
}

export interface PipOptions {
  sectionUid: string;
  count: number;
  hidden?: number;
  filter: CommentFilter;
  previews: readonly string[];
  onPip: (sectionUid: string) => void;
  onPipHover: (sectionUid: string | null) => void;
}

/** The pip as a DOM element, for the editors (a ProseMirror widget, a CodeMirror gutter marker). */
export function pipElement(options: PipOptions): HTMLElement {
  const pip = document.createElement("button");
  pip.type = "button";
  pip.className = "comment-pip";
  pip.contentEditable = "false";
  pip.dataset.commentPip = options.sectionUid;
  pip.setAttribute("aria-label", pipLabel(options.count, options.filter, options.hidden));
  pip.title = options.previews.join("\n");
  pip.append(bubbleElement(), pipText(options.count, options.hidden));
  pip.addEventListener("mousedown", (event) => event.preventDefault());
  pip.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onPip(options.sectionUid);
  });
  pip.addEventListener("mouseenter", () => options.onPipHover(options.sectionUid));
  pip.addEventListener("mouseleave", () => options.onPipHover(null));
  pip.addEventListener("focus", () => options.onPipHover(options.sectionUid));
  pip.addEventListener("blur", () => options.onPipHover(null));
  return pip;
}
