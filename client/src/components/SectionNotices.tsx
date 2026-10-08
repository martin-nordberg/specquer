import { X } from "lucide-react";
import type { SectionNotice } from "@specquer/shared/api";

/** A sentence for what a save changed. */
export function noticeText(notice: SectionNotice): string {
  switch (notice.kind) {
    case "renumbered":
      switch (notice.reason) {
        case "copy":
          return `${notice.id} in “${notice.title}” was a copy of another section and is now ${notice.newId}.`;
        case "reused":
          return `${notice.id} in “${notice.title}” belonged to a deleted section, so this section is now ${notice.newId}.`;
        case "unknown-prefix":
          return `${notice.id} in “${notice.title}” has a prefix the configuration doesn't name and is now ${notice.newId}.`;
        case "duplicate":
        case "collision":
          return `${notice.id} in “${notice.title}” is now ${notice.newId}.`;
      }
      break;
    case "restored":
      return `The ID of “${notice.title}” was changed to ${notice.id}; section IDs never change, so ${notice.newId} was put back.`;
    case "uid-replaced":
      return `${notice.id} in “${notice.title}” carried another section's UID and got its own.`;
    case "not-anchored":
      return "This file holds merge conflict markers, so its section anchors were left alone. Resolve the conflict and save again.";
  }
}

export interface SectionNoticesProps {
  notices: SectionNotice[];
  onDismiss: () => void;
  onShowProblems: () => void;
}

/** What the last save changed beyond adding anchors, under the file path until dismissed. */
export function SectionNotices({ notices, onDismiss, onShowProblems }: SectionNoticesProps) {
  if (notices.length === 0) return null;
  return (
    <div role="status" aria-label="Section changes" className="flex shrink-0 items-start gap-2 border-b bg-muted px-3 py-1 text-sm">
      <ul className="min-w-0 flex-1">
        {notices.map((notice, index) => (
          <li key={index}>{noticeText(notice)}</li>
        ))}
      </ul>
      <button type="button" className="shrink-0 rounded-sm px-1 underline outline-none focus-visible:ring-2 focus-visible:ring-ring/50" onClick={onShowProblems}>
        Section problems…
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 rounded-sm p-0.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onDismiss}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
