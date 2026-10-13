import { Send, Square, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Citation, MAX_QUESTION_LENGTH } from "@specquer/shared/chat";
import type { ChatState } from "@/app/chat-store";
import { Button } from "@/components/ui/button";
import { AnswerBox } from "./AnswerBox";
import { QuestionBubble } from "./QuestionBubble";

/**
 * The chat pane (Step 010, R1–R3, R6): the conversation, the input, **Send** or **Stop**, and
 * **Clear** with **Undo**. Enter sends and Shift+Enter starts a new line; Enter while an input
 * method is composing confirms the composition instead.
 */

export interface ChatPaneProps {
  state: ChatState;
  /** Why the input is disabled (no model or key), or `null`. */
  disabled: { hint: string; reason?: string } | null;
  onSend: (question: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onClear: () => void;
  onUndo: () => void;
  onOpenCitation: (citation: Citation) => void;
  isMissing: (citation: Citation) => boolean;
  /** The input took back a question that couldn't be sent. */
  onTakeDraft: () => void;
  onInput: () => void;
}

/** How close to the end (in pixels) the list must be to keep following a streaming answer. */
const FOLLOW_MARGIN = 40;

export function ChatPane({ state, disabled, onSend, onStop, onRetry, onClear, onUndo, onOpenCitation, isMissing, onTakeDraft, onInput }: ChatPaneProps) {
  const [input, setInput] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pending = state.pending;
  const busy = pending !== null && pending.phase !== "failed";
  const tooLong = input.length > MAX_QUESTION_LENGTH;

  // A question that couldn't be sent (its save failed) goes back to the input
  useEffect(() => {
    if (state.draft === null) return;
    setInput(state.draft);
    onTakeDraft();
  }, [state.draft, onTakeDraft]);

  // Follow new content unless the user has scrolled up
  useLayoutEffect(() => {
    const element = list.current;
    if (element !== null && following.current) element.scrollTop = element.scrollHeight;
  }, [state.turns, pending?.text, pending?.phase, pending?.error]);

  const send = () => {
    if (busy || tooLong || input.trim() === "" || disabled !== null) return;
    onSend(input);
    setInput("");
    following.current = true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    // An input method's Enter confirms the composition (keyCode 229 for older engines)
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Chat</h2>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" disabled={busy || state.turns.length === 0} onClick={onClear} title="Clear the conversation">
          <Trash2 /> Clear
        </Button>
      </div>
      {state.undo !== null && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-sm">
          <span className="flex-1">Conversation cleared.</span>
          <Button variant="outline" size="sm" onClick={onUndo}>
            Undo
          </Button>
        </div>
      )}
      <div
        ref={list}
        className="min-h-0 flex-1 overflow-auto px-3 py-2"
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_MARGIN;
        }}
      >
        {state.loadError !== null && (
          <p role="alert" className="text-sm text-error-text">
            Couldn't load the conversation: {state.loadError}
          </p>
        )}
        {state.loaded && state.turns.length === 0 && pending === null && (
          <p className="text-sm text-muted-foreground">Ask a question about the specs. Answers cite the sections they come from.</p>
        )}
        <ul aria-label="Conversation" className="grid gap-2">
          {state.turns.map((turn, index) => (
            <li key={`${turn.question.at}-${index}`} className="grid gap-1">
              <QuestionBubble text={turn.question.text} />
              <AnswerBox
                text={turn.answer.text}
                citations={turn.answer.citations}
                model={turn.answer.model}
                elapsedMs={turn.answer.elapsedMs}
                at={turn.answer.at}
                stopped={turn.answer.stopped}
                onOpenCitation={onOpenCitation}
                isMissing={isMissing}
              />
            </li>
          ))}
          {pending !== null && (
            <li className="grid gap-1">
              <QuestionBubble text={pending.question.text} />
              <AnswerBox
                text={pending.text}
                citations={pending.citations}
                {...(pending.phase === "failed" ? { error: pending.error ?? "The answer failed.", onRetry } : { phase: pending.phase })}
                onOpenCitation={onOpenCitation}
                isMissing={isMissing}
              />
            </li>
          )}
        </ul>
      </div>
      <div aria-live="polite" className="sr-only">
        {state.announcement}
      </div>
      <form
        className="grid shrink-0 gap-1 border-t px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={textarea}
            aria-label="Question"
            rows={2}
            value={input}
            disabled={disabled !== null}
            placeholder={disabled === null ? "Ask about the specs (Enter sends, Shift+Enter for a new line)" : undefined}
            aria-invalid={tooLong}
            className="min-h-10 flex-1 resize-y rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
            onChange={(event) => {
              setInput(event.target.value);
              onInput();
            }}
            onKeyDown={onKeyDown}
          />
          {busy ? (
            <Button type="button" variant="secondary" size="icon" aria-label="Stop" title="Stop the answer" onClick={onStop}>
              <Square />
            </Button>
          ) : (
            <Button type="submit" size="icon" aria-label="Send" title="Send" disabled={disabled !== null || tooLong || input.trim() === ""}>
              <Send />
            </Button>
          )}
        </div>
        {disabled !== null && (
          <p className="text-xs text-muted-foreground" title={disabled.reason}>
            {disabled.hint}
          </p>
        )}
        {tooLong && (
          <p role="alert" className="text-xs text-error-text">
            A question holds at most {MAX_QUESTION_LENGTH.toLocaleString()} characters.
          </p>
        )}
        {state.unknownCommand !== null && (
          <p role="alert" className="text-xs text-error-text">
            Unknown command: {state.unknownCommand}. Type /clear to clear the conversation.
          </p>
        )}
      </form>
    </section>
  );
}
