import type { SectionStatusLists } from "@specquer/shared/api";
import { type CommentFilter, type ThreadView, shownBy } from "@specquer/shared/comments";
import { analyzeBody } from "@specquer/shared/markdown";
import { type BadgeStatus, badgeStatus, statusesOfBody } from "./section-status";

/** A section's threads in the Comments pane (R7.2). */
export interface ThreadGroup {
  sectionUid: string;
  /** The section ID, or `null` for a placeholder. */
  sectionId: string | null;
  title: string;
  status?: BadgeStatus;
  threads: ThreadView[];
}

export interface ThreadGroups {
  /** Sections with threads the filter shows, in document order. */
  groups: ThreadGroup[];
  /** Threads the filter shows whose section isn't in the text being edited (decision D8). */
  detached: ThreadView[];
  /** How many threads the filter hides. */
  hidden: number;
}

/**
 * Groups a document's threads by section, from the text being edited, so a section deleted and
 * not yet saved shows its threads as detached at once. `include` is a section that gets a group
 * even without threads (one a new thread is being written on).
 */
export function groupThreads(
  body: string,
  threads: readonly ThreadView[],
  filter: CommentFilter,
  lists?: SectionStatusLists,
  include?: string,
): ThreadGroups {
  const sections = analyzeBody(body).sections;
  const statuses = lists === undefined ? [] : statusesOfBody(body, lists);
  const shown = threads.filter((thread) => shownBy(filter, thread.status));
  const bySection = new Map<string, ThreadView[]>();
  for (const thread of shown) bySection.set(thread.sectionUid, [...(bySection.get(thread.sectionUid) ?? []), thread]);
  const groups: ThreadGroup[] = [];
  const placed = new Set<string>();
  sections.forEach((section, index) => {
    const uid = section.uid;
    if (uid === null || placed.has(uid)) return;
    const own = bySection.get(uid);
    if (own === undefined && uid !== include) return;
    placed.add(uid);
    const status = statuses[index]?.status;
    groups.push({
      sectionUid: uid,
      sectionId: section.id,
      title: section.kind === "root" ? "Document" : section.title,
      ...(status === undefined ? {} : { status: badgeStatus(status) }),
      threads: own ?? [],
    });
  });
  return { groups, detached: shown.filter((thread) => !placed.has(thread.sectionUid)), hidden: threads.length - shown.length };
}

/** The threads the filter shows, in the order the pane lists them, for F8 (R8). */
export function threadOrder(groups: ThreadGroups): ThreadView[] {
  return [...groups.groups.flatMap((group) => group.threads), ...groups.detached];
}
