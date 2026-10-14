import { toggleClass } from "@/components/chat/ChatToggle";
import { BUBBLE_PATH } from "./markers";
import { Button } from "@/components/ui/button";

/** A hollow, rounded speech bubble with its tail at the lower left (Step 012, R1.2). */
function CommentsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={BUBBLE_PATH} />
    </svg>
  );
}

/** The header button that opens and closes the Comments pane (Step 012, R1.2). */
export function CommentsToggle({ open, onChange }: { open: boolean; onChange: (open: boolean) => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={toggleClass}
      aria-label="Comments"
      aria-pressed={open}
      title={open ? "Close the comments" : "Open the comments"}
      onClick={() => onChange(!open)}
    >
      <CommentsIcon />
    </Button>
  );
}
