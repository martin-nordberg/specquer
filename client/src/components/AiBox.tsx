import { LoaderCircle, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The box AI output is shown in: AI summaries in the preview and chat answers (Step 010). A
 * dashed, muted box with a label row (the sparkles, then the label's parts joined with " · ").
 */
export interface AiBoxProps {
  /** The accessible name of the box, e.g. "AI summary". */
  name: string;
  /** The label's parts, first the kind ("AI summary", "AI response"). */
  label: string[];
  /** The label's tooltip, e.g. the model's full ID. */
  title?: string;
  testId?: string;
  busy?: boolean;
  children: ReactNode;
}

export function AiBox({ name, label, title, testId, busy, children }: AiBoxProps) {
  return (
    <section aria-label={name} aria-busy={busy || undefined} className="my-3 rounded-md border border-dashed bg-muted/40 px-4 py-2" data-testid={testId}>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="size-3" aria-hidden />
        <span title={title}>{label.join(" · ")}</span>
      </div>
      {children}
    </section>
  );
}

/** The waiting line: a spinner (still when the system asks for reduced motion) and a text. */
export function AiWaiting({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-muted-foreground italic">
      <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
      {children}
    </p>
  );
}
