import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The header button that opens and closes the chat pane (Step 010, R1.1). */
export function ChatToggle({ open, onChange }: { open: boolean; onChange: (open: boolean) => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-navigation-foreground hover:bg-navigation-foreground/15 hover:text-navigation-foreground aria-pressed:bg-navigation-foreground/20"
      aria-label="Chat"
      aria-pressed={open}
      title={open ? "Close the chat" : "Open the chat"}
      onClick={() => onChange(!open)}
    >
      <MessageSquare />
    </Button>
  );
}
