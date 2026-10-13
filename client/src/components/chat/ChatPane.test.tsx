import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import type { ChatTurn, Citation } from "@specquer/shared/chat";
import type { ChatState } from "@/app/chat-store";
import { AnswerBox, STREAM_RENDER_INTERVAL, formatClock } from "./AnswerBox";
import { ChatPane, type ChatPaneProps } from "./ChatPane";

const CITATIONS: Citation[] = [
  { n: 1, path: "docs/a.md", outlinePath: "0", sectionId: "SPEC-00001", title: "Copies" },
  { n: 2, path: "notes/gone.md", outlinePath: "1", title: "Gone" },
];

const TURN: ChatTurn = {
  question: { text: "How are copies numbered?\nAnd why?", at: "2026-10-13T12:00:00.000Z" },
  answer: {
    text: "A copy gets a **new** ID [1], see [2] and [3].\n\n<img src=x onerror=alert(1)> [link](javascript:alert(1))",
    model: "google/gemma-4-31b-it",
    elapsedMs: 72_400,
    at: "2026-10-13T12:01:12.000Z",
    stopped: false,
    citations: CITATIONS,
  },
};

const STATE: ChatState = { turns: [], loaded: true, loadError: null, pending: null, unknownCommand: null, undo: null, draft: null, announcement: "" };

function setup(state: Partial<ChatState> = {}, props: Partial<ChatPaneProps> = {}) {
  const handlers = {
    onSend: mock((_question: string) => {}),
    onStop: mock(() => {}),
    onRetry: mock(() => {}),
    onClear: mock(() => {}),
    onUndo: mock(() => {}),
    onOpenCitation: mock((_citation: Citation) => {}),
    onTakeDraft: mock(() => {}),
    onInput: mock(() => {}),
  };
  const view = render(
    <ChatPane state={{ ...STATE, ...state }} disabled={null} isMissing={(citation) => citation.path === "notes/gone.md"} {...handlers} {...props} />,
  );
  const input = () => screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement;
  return { ...handlers, view, input };
}

describe("the input", () => {
  test("Enter sends, Shift+Enter starts a new line, blank does nothing", () => {
    const { input, onSend } = setup();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(input(), { target: { value: "Line one" } });
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("Line one");
    expect(input().value).toBe("");
  });

  test("Enter while an input method is composing doesn't send", () => {
    const { input, onSend } = setup();
    fireEvent.change(input(), { target: { value: "日本" } });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  test("a question longer than 8,000 characters isn't sent", () => {
    const { input, onSend } = setup();
    fireEvent.change(input(), { target: { value: "x".repeat(8001) } });
    expect(screen.getByRole("alert").textContent).toContain("8,000");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  test("without a model the input is disabled with the hint", () => {
    const { input } = setup({}, { disabled: { hint: "The chat needs a model: see .specquer/shared/agent.config.yaml", reason: "No model." } });
    expect(input().disabled).toBe(true);
    expect(screen.getByText(/The chat needs a model/).getAttribute("title")).toBe("No model.");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("a question that couldn't be sent comes back to the input", () => {
    const { input, onTakeDraft } = setup({ draft: "Lost question?" });
    expect(input().value).toBe("Lost question?");
    expect(onTakeDraft).toHaveBeenCalled();
  });

  test("an unknown command is reported", () => {
    setup({ unknownCommand: "/help" });
    expect(screen.getByRole("alert").textContent).toContain("Unknown command: /help");
  });
});

describe("the conversation", () => {
  test("questions as typed, answers as limited Markdown with only listed citations as links", () => {
    const { onOpenCitation } = setup({ turns: [TURN] });
    const question = screen.getByLabelText("Your question");
    expect(question.textContent).toBe("How are copies numbered?\nAnd why?");
    const answer = screen.getByRole("region", { name: "AI response" });
    expect(answer.querySelector("strong")?.textContent).toBe("new");
    expect(answer.querySelector("img")).toBeNull();
    expect(answer.querySelector("a")).toBeNull();
    expect(answer.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(answer.textContent).toContain("link (javascript:alert(1))");
    // [3] isn't listed: text
    expect(answer.textContent).toContain("and [3].");
    const citation = within(answer).getAllByRole("button", { name: "[1]" })[0]!;
    fireEvent.click(citation);
    expect(onOpenCitation).toHaveBeenCalledWith(CITATIONS[0]);
    // A citation whose file is gone can't be opened
    expect(within(answer).queryByRole("button", { name: "[2]" })).toBeNull();
    expect(answer.textContent).toContain("(no longer exists)");
    expect(within(answer).getByRole("button", { name: "[1] Copies" })).toBeDefined();
  });

  test("the label: AI response, the model's short name, the thinking time and the clock time", () => {
    setup({ turns: [TURN] });
    const answer = screen.getByRole("region", { name: "AI response" });
    const label = answer.querySelector("span[title]")!;
    expect(label.textContent).toStartWith("AI response · gemma-4-31b-it · 1 min 12 s · ");
    expect(label.getAttribute("title")).toBe("Answered by google/gemma-4-31b-it");
    setup({ turns: [{ ...TURN, answer: { ...TURN.answer, stopped: true, elapsedMs: 5000 } }] });
    expect(screen.getAllByRole("region", { name: "AI response" })[1]!.textContent).toContain("stopped after 5 s");
  });

  test("an answer under way: waiting, busy, Stop; a failed one: the error and Retry", () => {
    const pending = { question: { text: "Q?", at: "" }, citations: [], text: "", sentAt: 0 };
    const { onStop, view } = setup({ pending: { ...pending, phase: "searching" } });
    expect(screen.getByText("Searching the specs...")).toBeDefined();
    expect(screen.getByRole("region", { name: "AI response" }).getAttribute("aria-busy")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
    view.unmount();
    const { onRetry } = setup({ pending: { ...pending, phase: "failed", text: "Partial", error: "Rate limit." } });
    expect(screen.getByRole("alert").textContent).toBe("Rate limit.");
    expect(screen.getByText("Partial")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDefined();
  });

  test("Clear, and Undo while it is offered", () => {
    const { onClear, view } = setup({ turns: [TURN] });
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(onClear).toHaveBeenCalled();
    view.unmount();
    const { onUndo } = setup({ undo: [TURN] });
    expect(screen.getByRole("status").textContent).toContain("Conversation cleared.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalled();
  });

  test("the finished answer is announced once, through a polite live region", () => {
    const { view } = setup({ announcement: "The answer." });
    const live = view.container.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("The answer.");
  });
});

test("a streaming answer is rendered again at most every 150 ms", async () => {
  const props = { citations: [], phase: "streaming" as const, onOpenCitation: () => {}, isMissing: () => false };
  const view = render(<AnswerBox text="One" {...props} />);
  view.rerender(<AnswerBox text="One **two" {...props} />);
  view.rerender(<AnswerBox text="One **two**" {...props} />);
  await act(() => new Promise((resolve) => setTimeout(resolve, STREAM_RENDER_INTERVAL + 50)));
  await waitFor(() => expect(view.container.querySelector("strong")?.textContent).toBe("two"));
});

test("formatClock shows the date when it isn't today", () => {
  const now = new Date("2026-10-13T15:00:00");
  expect(formatClock(new Date("2026-10-13T12:05:00").toISOString(), now)).not.toContain("2026");
  expect(formatClock(new Date("2026-10-12T12:05:00").toISOString(), now)).toContain(new Date("2026-10-12T12:05:00").toLocaleDateString());
});
