import type { TreeView } from "@specquer/shared/uistate";
import { cn } from "@/lib/utils";

const views: Array<{ type: TreeView; label: string }> = [
  { type: "specs", label: "Specs" },
  { type: "all", label: "All Files" },
];

/** The folder pane's view selector (Step 014, R1.1), like the file pane's. */
export function TreeViewSwitcher({ value, onChange }: { value: TreeView; onChange: (view: TreeView) => void }) {
  return (
    <div role="radiogroup" aria-label="Files shown" className="m-2 flex shrink-0 self-start rounded-md border p-0.5">
      {views.map(({ type, label }) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={value === type}
          className={cn(
            "rounded-sm px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            value === type ? "bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
          onClick={() => onChange(type)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
