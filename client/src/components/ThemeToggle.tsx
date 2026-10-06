import { Moon, Sun } from "lucide-react";
import type { Theme } from "@specquer/shared/uistate";
import { Button } from "@/components/ui/button";

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-navigation-foreground hover:bg-navigation-foreground/15 hover:text-navigation-foreground"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => onChange(next)}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
