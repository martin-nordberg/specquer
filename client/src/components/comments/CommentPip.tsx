import type { CommentFilter } from "@specquer/shared/comments";
import { BUBBLE_PATH, pipLabel, pipText } from "./markers";

export interface CommentPipProps {
  sectionUid: string;
  count: number;
  /** Threads of sections the summary slider hides, counted here (R5.6). */
  hidden?: number;
  filter: CommentFilter;
  previews: readonly string[];
  onPip: (sectionUid: string) => void;
  onPipHover: (sectionUid: string | null) => void;
}

/**
 * The comment pip beside a section badge in the preview (R5): the number of the section's threads
 * the filter shows, the first line of each in its tooltip; a click opens the Comments pane at the
 * section, and hovering highlights the section's threads there.
 */
export function CommentPip({ sectionUid, count, hidden = 0, filter, previews, onPip, onPipHover }: CommentPipProps) {
  return (
    <button
      type="button"
      className="comment-pip"
      data-comment-pip={sectionUid}
      aria-label={pipLabel(count, filter, hidden)}
      title={previews.join("\n")}
      onClick={() => onPip(sectionUid)}
      onMouseEnter={() => onPipHover(sectionUid)}
      onMouseLeave={() => onPipHover(null)}
      onFocus={() => onPipHover(sectionUid)}
      onBlur={() => onPipHover(null)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" aria-hidden>
        <path d={BUBBLE_PATH} />
      </svg>
      {pipText(count, hidden)}
    </button>
  );
}
