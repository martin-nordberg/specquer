import { LoaderCircle, Sparkles } from "lucide-react";
import type { SummaryEntry } from "@/app/summaries";
import { Button } from "@/components/ui/button";

export interface SectionSummaryProps {
  entry: SummaryEntry | undefined;
  /** The section has unsaved changes: the summary is of the saved text. */
  outOfDate: boolean;
  onRetry: () => void;
  /** Shows the section's full text. */
  onShowFullText: () => void;
}

/**
 * A section's AI summary in the preview, as plain text (decision D2): model output is untrusted
 * and never rendered as Markdown or HTML.
 */
export function SectionSummary({ entry, outOfDate, onRetry, onShowFullText }: SectionSummaryProps) {
  const loading = entry === undefined || entry.state === "loading";
  const label = ["AI summary", ...(entry?.state === "done" && entry.truncated ? ["shortened"] : []), ...(outOfDate ? ["out of date"] : [])].join(" · ");
  return (
    <section aria-label="AI summary" className="my-3 rounded-md border border-dashed bg-muted/40 px-4 py-2" data-testid="section-summary">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {/* Turns slowly while the summary is made; the star is the icon's center */}
        <Sparkles className={loading ? "size-3 motion-safe:animate-spin motion-safe:[animation-duration:3s]" : "size-3"} aria-hidden />
        <span>{label}</span>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-muted-foreground italic">
          <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
          Summarizing...
        </p>
      ) : entry.state === "error" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-error-text">Couldn't summarize: {entry.message}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="cursor-pointer" title="Show the full text" onClick={onShowFullText}>
          {entry.summary.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index} className="my-1">
              {paragraph}
            </p>
          ))}
        </div>
      )}
      <button type="button" className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={onShowFullText}>
        Show full text
      </button>
    </section>
  );
}
