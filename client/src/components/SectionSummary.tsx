import type { SummaryEntry } from "@/app/summaries";
import { AiBox, AiWaiting } from "@/components/AiBox";
import { Button } from "@/components/ui/button";

export interface SectionSummaryProps {
  entry: SummaryEntry | undefined;
  /** The section has unsaved changes: the summary is of the saved text. */
  outOfDate: boolean;
  onRetry: () => void;
  /** Shows the section's full text. */
  onShowFullText: () => void;
}

/** A model ID's last part (`google/gemma-4-31b-it` → `gemma-4-31b-it`), for the label. */
export function shortModelName(model: string): string {
  return model.slice(model.lastIndexOf("/") + 1);
}

/**
 * A section's AI summary in the preview, as plain text (decision D2): model output is untrusted
 * and never rendered as Markdown or HTML. The label names the model that made it (the full ID in
 * a tooltip), and marks a summary from another model shown until the configured one's arrives.
 */
export function SectionSummary({ entry, outOfDate, onRetry, onShowFullText }: SectionSummaryProps) {
  const loading = entry === undefined || entry.state === "loading";
  const done = entry?.state === "done" ? entry : undefined;
  const label = [
    "AI summary",
    ...(done === undefined ? [] : [shortModelName(done.model)]),
    ...(done !== undefined && !done.current ? ["older model"] : []),
    ...(done?.truncated === true ? ["shortened"] : []),
    ...(outOfDate ? ["out of date"] : []),
  ];
  return (
    <AiBox name="AI summary" label={label} title={done === undefined ? undefined : `Made by ${done.model}`} testId="section-summary">
      {loading ? (
        <AiWaiting>Summarizing...</AiWaiting>
      ) : entry.state === "error" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-error-text">Couldn't summarize: {entry.message}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
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
      {done?.refreshError !== undefined && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <p className="text-error-text">Couldn't summarize with the configured model: {done.refreshError}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      <button type="button" className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={onShowFullText}>
        Show full text
      </button>
    </AiBox>
  );
}
