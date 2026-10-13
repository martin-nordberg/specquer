import { type Components, toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Copy } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { type Citation, formatElapsed } from "@specquer/shared/chat";
import { CITATION_TAG, answerToHast } from "@specquer/shared/markdown";
import { AiBox, AiWaiting } from "@/components/AiBox";
import { shortModelName } from "@/components/SectionSummary";
import { Button } from "@/components/ui/button";

/**
 * A chat answer (Step 010, R3): limited Markdown from the shared answer pipeline, where the only
 * links are citations whose numbers the server listed, in the AI box with "AI response", the
 * model, the thinking time and the clock time. While it streams it is rendered again at most
 * every 150 ms (decision D8).
 */

/** How often a streaming answer is rendered again. */
export const STREAM_RENDER_INTERVAL = 150;

export interface AnswerBoxProps {
  text: string;
  citations: Citation[];
  /** While the answer is under way: the phase before the first words. */
  phase?: "saving" | "searching" | "thinking" | "streaming";
  model?: string;
  elapsedMs?: number;
  /** When it ended (ISO). */
  at?: string;
  stopped?: boolean;
  error?: string;
  onRetry?: () => void;
  onOpenCitation: (citation: Citation) => void;
  /** Whether a citation's file is gone, so it can't be opened. */
  isMissing: (citation: Citation) => boolean;
  now?: () => Date;
}

const WAITING: Record<"saving" | "searching" | "thinking", string> = {
  saving: "Saving the open file...",
  searching: "Searching the specs...",
  thinking: "Thinking...",
};

/** The clock time of an answer: local time, with the date when it isn't today. */
export function formatClock(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === now.toDateString() ? time : `${date.toLocaleDateString()} ${time}`;
}

/** `value`, but changing at most every `interval` ms while `throttle` is on. */
function useThrottled<T>(value: T, interval: number, throttle: boolean): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (!throttle) {
      setShown(value);
      return;
    }
    const wait = Math.max(0, last.current + interval - Date.now());
    const timer = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, interval, throttle]);
  return throttle ? shown : value;
}

/** The numbers the text cites that are in the list, in order of first use. */
function citedNumbers(text: string, citations: Citation[]): number[] {
  const listed = new Set(citations.map((citation) => citation.n));
  const cited: number[] = [];
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (listed.has(n) && !cited.includes(n)) cited.push(n);
  }
  return cited;
}

export function AnswerBox(props: AnswerBoxProps) {
  const { text, citations, phase, model, elapsedMs, at, stopped, error, onRetry, onOpenCitation, isMissing, now } = props;
  const streaming = phase !== undefined;
  const shownText = useThrottled(text, STREAM_RENDER_INTERVAL, streaming);
  const byNumber = useMemo(() => new Map(citations.map((citation) => [citation.n, citation])), [citations]);

  const body = useMemo(() => {
    const CitationLink = (linkProps: { "data-n"?: string; children?: ReactNode }) => {
      const citation = byNumber.get(Number(linkProps["data-n"]));
      if (citation === undefined) return <>{linkProps.children}</>;
      return <CitationButton citation={citation} missing={isMissing(citation)} onOpen={onOpenCitation} label={`[${citation.n}]`} />;
    };
    const tree = answerToHast(shownText, byNumber.keys());
    const components = { [CITATION_TAG]: CitationLink } as unknown as Partial<Components>;
    return toJsxRuntime(tree, { Fragment, jsx, jsxs, components }) as ReactNode;
  }, [shownText, byNumber, isMissing, onOpenCitation]);

  const cited = citedNumbers(text, citations);
  const label = [
    "AI response",
    ...(model === undefined || model === "" ? [] : [shortModelName(model)]),
    ...(elapsedMs === undefined ? [] : [stopped === true ? `stopped after ${formatElapsed(elapsedMs)}` : formatElapsed(elapsedMs)]),
    ...(at === undefined ? [] : [formatClock(at, now?.())]),
  ];

  return (
    <AiBox name="AI response" label={label} title={model === undefined ? undefined : `Answered by ${model}`} busy={streaming} testId="chat-answer">
      {phase !== undefined && phase !== "streaming" && text === "" ? (
        <AiWaiting>{WAITING[phase]}</AiWaiting>
      ) : (
        <div className="chat-answer grid gap-2 text-sm [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2 [&_ul]:list-disc [&_ul]:pl-5">
          {body}
        </div>
      )}
      {error !== undefined && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-error-text">
            {error}
          </p>
          {onRetry !== undefined && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}
      {!streaming && error === undefined && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {cited.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-2">
              Sources:
              {cited.map((n) => {
                const citation = byNumber.get(n)!;
                return (
                  <CitationButton key={n} citation={citation} missing={isMissing(citation)} onOpen={onOpenCitation} label={`[${n}] ${citation.title}`} />
                );
              })}
            </span>
          )}
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy the answer"
            title="Copy the answer"
            onClick={() => void navigator.clipboard?.writeText(text).catch(() => undefined)}
          >
            <Copy />
          </Button>
        </div>
      )}
    </AiBox>
  );
}

function CitationButton({ citation, missing, onOpen, label }: { citation: Citation; missing: boolean; onOpen: (citation: Citation) => void; label: string }) {
  const where = `${citation.title} (${citation.path})`;
  if (missing) {
    return (
      <span className="text-muted-foreground" title={`${where} no longer exists`}>
        {label} <span className="text-xs">(no longer exists)</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="rounded-sm text-foreground underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/50"
      title={where}
      onClick={() => onOpen(citation)}
    >
      {label}
    </button>
  );
}
