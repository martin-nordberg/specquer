import { toggleClass } from "@/components/chat/ChatToggle";
import { Button } from "@/components/ui/button";

/** A hollow, rounded speech bubble with its tail at the lower left (Step 012, R1.2). */
function CommentsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4c5 0 9 3.1 9 7s-4 7-9 7c-1.2 0-2.4-.2-3.4-.5L3 20l1.6-4C3.6 14.7 3 12.9 3 11c0-3.9 4-7 9-7z" />
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
