import { Button } from "@/components/ui/button";

export const toggleClass =
  "text-navigation-foreground hover:bg-navigation-foreground/15 hover:text-navigation-foreground aria-pressed:bg-navigation-foreground/20";

/** A speech bubble with its tail at the lower right and a small four-point AI star inside (Step 012, R1.1). */
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 15a2 2 0 0 0 2 2h12l4 4V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" />
      <path d="M12 6.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** The header button that opens and closes the chat pane (Step 010, R1.1). */
export function ChatToggle({ open, onChange, className }: { open: boolean; onChange: (open: boolean) => void; className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={`${toggleClass} ${className ?? ""}`}
      aria-label="Chat"
      aria-pressed={open}
      title={open ? "Close the chat" : "Open the chat"}
      onClick={() => onChange(!open)}
    >
      <ChatIcon />
    </Button>
  );
}
