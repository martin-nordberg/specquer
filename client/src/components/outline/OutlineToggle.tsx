import { TableOfContents } from "lucide-react";
import { toggleClass } from "@/components/chat/ChatToggle";
import { Button } from "@/components/ui/button";

/** The header button that opens and closes the Outline pane (Step 016, R1.1). */
export function OutlineToggle({ open, onChange }: { open: boolean; onChange: (open: boolean) => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={toggleClass}
      aria-label="Outline"
      aria-pressed={open}
      title={open ? "Close the outline" : "Open the outline"}
      onClick={() => onChange(!open)}
    >
      {/* Lucide's icon, mirrored horizontally */}
      <TableOfContents className="-scale-x-100" />
    </Button>
  );
}
