import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import { useState } from "react";
import type { SummaryRequest, SummaryResult } from "@specquer/shared/api";
import { MAX_IN_FLIGHT, SummaryStore } from "@/app/summaries";
import type { Api } from "@/lib/api";
import { ApiRequestError } from "@/lib/api";
import { Preview, type PreviewSummaries } from "./Preview";
import { SummaryControl } from "./SummaryControl";

const words = (n: number, word: string) => Array(n).fill(word).join(" ");

/** h1 with two h2s: 4 stops. Section "A1" is long, "A2" short. */
const BODY = `Intro text.\n\n# Top\n\nLead.\n\n## A1\n\n${words(80, "alpha")}\n\n## A2\n\nShort one.\n`;

type Summarize = (request: SummaryRequest, signal?: AbortSignal) => Promise<SummaryResult>;

function fakeApi(summarize: Summarize = async (request) => ({ summary: `Summary of ${request.text.split("\n")[0]}.`, model: "m", cached: false, truncated: false })) {
  const calls: Array<{ request: SummaryRequest; signal?: AbortSignal }> = [];
  const api = {
    summarize: mock((request: SummaryRequest, signal?: AbortSignal) => {
      calls.push({ request, signal });
      return summarize(request, signal);
    }),
  } as unknown as Api;
  return { api, calls };
}

function Harness({
  store,
  markdown = BODY,
  savedBody = BODY,
  initialSteps = 0,
  enabled = true,
  onSteps,
}: {
  store: SummaryStore;
  markdown?: string;
  savedBody?: string;
  initialSteps?: number;
  enabled?: boolean;
  onSteps?: (steps: number) => void;
}) {
  const [steps, setSteps] = useState(initialSteps);
  const summaries: PreviewSummaries = {
    enabled,
    ...(enabled ? {} : { problem: "No model is configured." }),
    savedBody,
    steps,
    onStepsChange: (next) => {
      onSteps?.(next);
      setSteps(next);
    },
    store,
  };
  return <Preview markdown={markdown} currentFile="docs/a.md" onOpenFile={() => {}} summaries={summaries} />;
}

const slider = () => screen.getByRole("slider", { name: "Summary level" });
const headings = () => screen.getAllByRole("heading").map((h) => h.textContent?.trim());

describe("SummaryControl", () => {
  test("shows the current stop's name, and moves by keyboard", () => {
    const onChange = mock((_stop: number) => {});
    render(<SummaryControl count={4} stop={3} names={["Summarize document", "Summarize level 1 sections", "Summarize level 2 sections", "Full text"]} onChange={onChange} />);
    expect(slider().getAttribute("aria-valuetext")).toBe("Full text");
    expect(screen.getByText("Full text")).toBeDefined();
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(2);
  });

  test("is disabled with a hint when summaries aren't enabled", () => {
    render(<SummaryControl count={3} stop={2} names={["a", "b", "c"]} onChange={() => {}} problem="No key." />);
    expect(slider().getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText(/agent\.config\.yaml/).getAttribute("title")).toBe("No key.");
  });
});

describe("the summarized preview", () => {
  test("no slider for a document without headings", async () => {
    const { api } = fakeApi();
    render(<Harness store={new SummaryStore(api)} markdown="Just text." savedBody="Just text." />);
    await waitFor(() => expect(screen.getByText("Just text.")).toBeDefined());
    expect(screen.queryByTestId("summary-control")).toBeNull();
  });

  test("the full text by default, with no requests", async () => {
    const { api, calls } = fakeApi();
    render(<Harness store={new SummaryStore(api)} />);
    await waitFor(() => expect(slider().getAttribute("aria-valuetext")).toBe("Full text"));
    expect(headings()).toEqual(["Top", "A1", "A2"]);
    expect(screen.getByText(/alpha alpha/)).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  test("each stop replaces sections with summaries; short sections stay as written", async () => {
    const { api, calls } = fakeApi();
    const store = new SummaryStore(api);
    render(<Harness store={store} initialSteps={1} />);
    // Level 2: A1 summarized, A2 (short) as written
    await waitFor(() => expect(screen.getByText("Summary of ## A1.")).toBeDefined());
    expect(slider().getAttribute("aria-valuetext")).toBe("Summarize level 2 sections");
    expect(headings()).toEqual(["Top", "A1", "A2"]);
    expect(screen.queryByText(/alpha alpha/)).toBeNull();
    expect(screen.getByText("Short one.")).toBeDefined();
    expect(screen.getByText("Lead.")).toBeDefined();
    expect(calls.map((c) => c.request.headings)).toEqual([["Top"]]);
    expect(calls[0]!.request.text.startsWith("## A1\n\nalpha")).toBe(true);

    // Level 1: Top summarized with everything below it; the intro stays
    act(() => void fireEvent.keyDown(slider(), { key: "ArrowLeft" }));
    await waitFor(() => expect(screen.getByText("Summary of # Top.")).toBeDefined());
    expect(headings()).toEqual(["Top"]);
    expect(screen.getByText("Intro text.")).toBeDefined();

    // The document: no headings remain
    act(() => void fireEvent.keyDown(slider(), { key: "ArrowLeft" }));
    await waitFor(() => expect(screen.getByText("Summary of Intro text..")).toBeDefined());
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.queryByText("Intro text.")).toBeNull();

    // Back to level 2: the summary comes from memory
    act(() => void fireEvent.keyDown(slider(), { key: "ArrowRight" }));
    act(() => void fireEvent.keyDown(slider(), { key: "ArrowRight" }));
    await waitFor(() => expect(screen.getByText("Summary of ## A1.")).toBeDefined());
    expect(calls).toHaveLength(3);
  });

  test("Summarizing... while waiting, an AI label, and an error with Retry", async () => {
    let fail = true;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { api, calls } = fakeApi(async () => {
      await gate;
      if (fail) throw new ApiRequestError(429, "The model provider's rate limit was reached.");
      return { summary: "First paragraph.\n\nSecond paragraph.", model: "m", cached: false, truncated: true };
    });
    render(<Harness store={new SummaryStore(api)} initialSteps={1} />);
    await waitFor(() => expect(screen.getByText("Summarizing...")).toBeDefined());
    await act(async () => release());
    await waitFor(() => expect(screen.getByText(/rate limit was reached/)).toBeDefined());
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Second paragraph.")).toBeDefined());
    const summary = screen.getByRole("region", { name: "AI summary" });
    expect(within(summary).getByText("AI summary · shortened")).toBeDefined();
    expect(within(summary).getAllByText(/paragraph\./)).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  test("clicking a summary shows the full text", async () => {
    const { api } = fakeApi();
    const onSteps = mock((_steps: number) => {});
    render(<Harness store={new SummaryStore(api)} initialSteps={1} onSteps={onSteps} />);
    await waitFor(() => expect(screen.getByText("Summary of ## A1.")).toBeDefined());
    fireEvent.click(screen.getByText("Summary of ## A1."));
    expect(onSteps).toHaveBeenCalledWith(0);
    await waitFor(() => expect(screen.getByText(/alpha alpha/)).toBeDefined());
    expect(document.querySelector('[data-outline-path="0.0"]')?.textContent).toBe("A1");
  });

  test("unsaved edits mark the summary out of date and are never sent; a save requests it again", async () => {
    const { api, calls } = fakeApi();
    const store = new SummaryStore(api);
    const edited = BODY.replace("alpha alpha", "alpha CHANGED alpha");
    const { rerender } = render(<Harness store={store} initialSteps={1} markdown={edited} savedBody={BODY} />);
    await waitFor(() => expect(screen.getByText("Summary of ## A1.")).toBeDefined());
    expect(screen.getByText("AI summary · out of date")).toBeDefined();
    expect(calls.every((c) => !c.request.text.includes("CHANGED"))).toBe(true);
    // Saved
    rerender(<Harness store={store} initialSteps={1} markdown={edited} savedBody={edited} />);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.request.text).toContain("CHANGED");
    await waitFor(() => expect(screen.getByText("AI summary")).toBeDefined());
  });

  test("a new section that isn't saved yet is shown as written", async () => {
    const { api, calls } = fakeApi();
    const added = `${BODY}\n## A3\n\n${words(80, "gamma")}\n`;
    render(<Harness store={new SummaryStore(api)} initialSteps={1} markdown={added} savedBody={BODY} />);
    await waitFor(() => expect(screen.getByText("Summary of ## A1.")).toBeDefined());
    expect(screen.getByText(/gamma gamma/)).toBeDefined();
    expect(calls).toHaveLength(1);
  });

  test("requests no longer needed are aborted when the stop changes", async () => {
    const { api, calls } = fakeApi((_request, signal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason))));
    render(<Harness store={new SummaryStore(api)} initialSteps={1} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => void fireEvent.keyDown(slider(), { key: "ArrowRight" }));
    await waitFor(() => expect(calls[0]!.signal?.aborted).toBe(true));
  });

  test("at most a few requests are in flight, so other requests aren't held up", async () => {
    const pending: Array<() => void> = [];
    const { api, calls } = fakeApi((request) => new Promise((resolve) => pending.push(() => resolve({ summary: `Summary of ${request.text.split("\n")[0]}.`, model: "m", cached: false, truncated: false }))));
    const body = `# Top\n\n${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `## S${n}\n\n${words(80, "alpha")}\n`).join("\n")}`;
    render(<Harness store={new SummaryStore(api)} initialSteps={1} markdown={body} savedBody={body} />);
    await waitFor(() => expect(calls).toHaveLength(MAX_IN_FLIGHT));
    // In document order; one finishing lets the next one go
    expect(calls.map((c) => c.request.text.split("\n")[0])).toEqual(["## S1", "## S2", "## S3"]);
    await act(async () => pending.shift()!());
    await waitFor(() => expect(calls).toHaveLength(MAX_IN_FLIGHT + 1));
    expect(screen.getByText("Summary of ## S1.")).toBeDefined();
    // Moving the slider drops the queued ones without sending them
    act(() => void fireEvent.keyDown(slider(), { key: "ArrowRight" }));
    await waitFor(() => expect(screen.queryByText("Summarizing...")).toBeNull());
    for (const release of pending) await act(async () => release());
    expect(calls).toHaveLength(MAX_IN_FLIGHT + 1);
  });

  test("disabled: the full text, whatever the stored position", async () => {
    const { api, calls } = fakeApi();
    render(<Harness store={new SummaryStore(api)} initialSteps={2} enabled={false} />);
    await waitFor(() => expect(slider().getAttribute("aria-valuetext")).toBe("Full text"));
    expect(screen.getByText(/alpha alpha/)).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  test("a link to a section hidden by a summary shows the full text", async () => {
    const { api } = fakeApi();
    // Level 2 summarizes A1, with the subsection holding the anchor
    const body = `# Top\n\n## A1\n\n${words(80, "alpha")}\n\n<a id="REQ-00005"></a>\n### Deep\n\n${words(10, "beta")}\n`;
    const onSteps = mock((_steps: number) => {});
    render(
      <PreviewWithTarget store={new SummaryStore(api)} body={body} onSteps={onSteps} />,
    );
    await waitFor(() => expect(onSteps).toHaveBeenCalledWith(0));
    await waitFor(() => expect(document.getElementById("user-content-REQ-00005")).not.toBeNull());
  });
});

function PreviewWithTarget({ store, body, onSteps }: { store: SummaryStore; body: string; onSteps: (steps: number) => void }) {
  const [steps, setSteps] = useState(2);
  return (
    <Preview
      markdown={body}
      currentFile="docs/a.md"
      onOpenFile={() => {}}
      scrollTarget={{ sectionId: "REQ-00005", request: 1 }}
      summaries={{
        enabled: true,
        savedBody: body,
        steps,
        onStepsChange: (next) => {
          onSteps(next);
          setSteps(next);
        },
        store,
      }}
    />
  );
}
