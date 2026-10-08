import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export interface SummaryControlProps {
  /** The number of stops (at least 3). */
  count: number;
  /** The current stop: 0 summarizes the document, `count - 1` is the full text. */
  stop: number;
  /** The accessible name of each stop. */
  names: string[];
  onChange: (stop: number) => void;
  /** Set when summaries can't be made: the slider is disabled with this hint. */
  problem?: string;
  className?: string;
}

/** The summary slider above the preview, with the current stop's name beside it. */
export function SummaryControl({ count, stop, names, onChange, problem, className }: SummaryControlProps) {
  const disabled = problem !== undefined;
  const name = names[stop] ?? "";
  return (
    <div className={cn("flex shrink-0 items-center gap-3 border-b px-3 py-1.5 text-xs", className)} data-testid="summary-control">
      <span className="shrink-0 text-muted-foreground">Summary</span>
      <Slider
        className="w-32 shrink-0"
        min={0}
        max={count - 1}
        step={1}
        value={[stop]}
        disabled={disabled}
        onValueChange={([value]) => value !== undefined && value !== stop && onChange(value)}
        thumbProps={{ "aria-label": "Summary level", "aria-valuetext": name }}
      />
      {disabled ? (
        <span className="min-w-0 truncate text-muted-foreground" title={problem}>
          Summaries need a model: see .specquer/shared/agent.config.yaml
        </span>
      ) : (
        <span className="min-w-0 truncate" aria-live="polite">
          {name}
        </span>
      )}
    </div>
  );
}
