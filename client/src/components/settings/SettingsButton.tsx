import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The gear button in the header that opens the system settings. */
export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-navigation-foreground hover:bg-navigation-foreground/15 hover:text-navigation-foreground"
      aria-label="Settings"
      title="Settings"
      onClick={onClick}
    >
      <Settings />
    </Button>
  );
}
