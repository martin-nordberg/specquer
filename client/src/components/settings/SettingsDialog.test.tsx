import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import type { AgentSettings, AgentSettingsUpdate, ModelTestResult } from "@specquer/shared/api";
import type { SettingsSaveOutcome } from "@/lib/api";
import { SettingsDialog } from "./SettingsDialog";
import { buildUpdates, emptyModelDraft, emptySummaryDraft } from "./settings-form";

const MODEL = { provider: "nvidia" as const, name: "google/gemma-4-31b-it", baseUrl: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_API_KEY" };

const CHAT_DEFAULTS = { units: 8, contextTokens: 12_000, historyTurns: 10, historyTokens: 8_000, answerTokens: 4_000 };
const CHAT_SOURCES = { units: "default", contextTokens: "default", historyTurns: "default", historyTokens: "default", answerTokens: "default" } as const;

const SETTINGS: AgentSettings = {
  shared: { version: "v-shared", model: MODEL, summaries: { concurrency: 2 }, chat: {}, warnings: [] },
  personal: { version: "v-personal", summaries: { concurrency: 4 }, chat: {}, warnings: [] },
  effective: { model: MODEL, summaries: { concurrency: 4, tokenBudget: 24_000, prefill: false }, chat: CHAT_DEFAULTS },
  sources: { model: "shared", summaries: { concurrency: "personal", tokenBudget: "default", prefill: "default" }, chat: CHAT_SOURCES },
  keys: { NVIDIA_API_KEY: true },
  status: { enabled: true, model: "google/gemma-4-31b-it" },
};

function setup(options: { settings?: AgentSettings; save?: (update: AgentSettingsUpdate) => Promise<SettingsSaveOutcome>; testModel?: () => Promise<ModelTestResult> } = {}) {
  const api = {
    agentSettings: mock(async () => options.settings ?? SETTINGS),
    saveAgentSettings: mock(options.save ?? (async () => ({ kind: "saved", version: "new" }) as SettingsSaveOutcome)),
    envSet: mock(async (name: string) => name === "OTHER_KEY"),
    testModel: mock(options.testModel ?? (async () => ({ ok: true, ms: 1234 }) as ModelTestResult)),
  };
  const onClose = mock(() => {});
  const onSaved = mock(() => {});
  render(<SettingsDialog open onClose={onClose} api={api} onSaved={onSaved} />);
  return { api, onClose, onSaved };
}

const dialog = () => screen.getByRole("dialog", { name: "Settings" });
const field = (name: string) => within(dialog()).getByRole("textbox", { name }) as HTMLInputElement;
const button = (name: string) => within(dialog()).getByRole("button", { name }) as HTMLButtonElement;
/** Radix tabs switch on mouse down. */
const openTab = (name: string) => fireEvent.mouseDown(within(dialog()).getByRole("tab", { name }), { button: 0 });
const chooseScope = (name: "Personal" | "Shared") => fireEvent.click(within(dialog()).getByRole("radio", { name }));

describe("SettingsDialog", () => {
  test("shows each value in effect and where it comes from, per scope", async () => {
    setup();
    await waitFor(() => expect(field("Model ID").value).toBe("google/gemma-4-31b-it"));
    expect(dialog().textContent).toContain("NVIDIA_API_KEY: found.");
    expect(within(dialog()).getByLabelText("Model status").textContent).toBe("Summaries are on, with google/gemma-4-31b-it.");
    openTab("Summarization");
    expect(field("Concurrent model calls").value).toBe("4");
    expect(within(dialog()).getByRole("button", { name: /Reset concurrent model calls/ })).toBeTruthy();
    chooseScope("Shared");
    expect(field("Concurrent model calls").value).toBe("2");
    expect(dialog().textContent).toContain("(overridden by your personal setting)");
    expect(within(dialog()).queryByRole("button", { name: /Reset/ })).toBeNull();
  });

  test("editing one model field saves the whole model block to the personal file", async () => {
    const { api, onSaved, onClose } = setup();
    await waitFor(() => expect(field("Model ID").value).not.toBe(""));
    expect(button("Save").disabled).toBe(true);
    fireEvent.change(field("Model ID"), { target: { value: "other/model" } });
    button("Save").click();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.saveAgentSettings).toHaveBeenCalledWith({ scope: "personal", baseVersion: "v-personal", summaries: {}, model: { ...MODEL, name: "other/model" } });
    expect(onSaved).toHaveBeenCalled();
  });

  test("the Chat tab shows the chat settings and saves the ones changed, invalid values keeping Save disabled", async () => {
    const { api } = setup();
    await waitFor(() => expect(field("Model ID").value).not.toBe(""));
    openTab("Chat");
    expect(field("Sections per question").value).toBe("8");
    expect(field("Earlier questions sent").value).toBe("10");
    fireEvent.change(field("Sections per question"), { target: { value: "50" } });
    expect(dialog().textContent).toContain("Enter a whole number from 1 to 20.");
    expect(button("Save").disabled).toBe(true);
    fireEvent.change(field("Sections per question"), { target: { value: "5" } });
    button("Save").click();
    await waitFor(() => expect(api.saveAgentSettings).toHaveBeenCalledWith({ scope: "personal", baseVersion: "v-personal", summaries: {}, chat: { units: 5 } }));
  });

  test("Reset removes a personal value", async () => {
    const { api } = setup();
    await waitFor(() => expect(field("Model ID").value).not.toBe(""));
    openTab("Summarization");
    button("Reset concurrent model calls to the shared setting").click();
    await waitFor(() => expect(field("Concurrent model calls").value).toBe("2"));
    button("Save").click();
    await waitFor(() => expect(api.saveAgentSettings).toHaveBeenCalledWith({ scope: "personal", baseVersion: "v-personal", summaries: { concurrency: null } }));
  });

  test("switching scope with unsaved changes asks first", async () => {
    setup();
    await waitFor(() => expect(field("Model ID").value).not.toBe(""));
    fireEvent.change(field("Model ID"), { target: { value: "other/model" } });
    chooseScope("Shared");
    button("Keep editing").click();
    expect(field("Model ID").value).toBe("other/model");
    chooseScope("Shared");
    button("Discard").click();
    await waitFor(() => expect(field("Model ID").value).toBe("google/gemma-4-31b-it"));
    expect((within(dialog()).getByRole("radio", { name: "Shared" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
  });

  test("invalid values are reported and disable Save", async () => {
    setup();
    await waitFor(() => expect(field("Model ID").value).not.toBe(""));
    fireEvent.change(field("Base URL"), { target: { value: "ftp://example.com" } });
    expect(field("Base URL").getAttribute("aria-invalid")).toBe("true");
    expect(dialog().textContent).toContain("Enter an http or https URL.");
    expect(button("Save").disabled).toBe(true);
    expect(button("Test").disabled).toBe(true);
    fireEvent.change(field("Base URL"), { target: { value: "https://example.com/v1" } });
    openTab("Summarization");
    fireEvent.change(field("Concurrent model calls"), { target: { value: "17" } });
    expect(dialog().textContent).toContain("Enter a whole number from 1 to 16.");
    expect(button("Save").disabled).toBe(true);
  });

  test("a key variable that isn't set says to restart", async () => {
    setup();
    await waitFor(() => expect(field("Model ID").value).not.toBe(""));
    fireEvent.change(field("API key variable"), { target: { value: "MISSING_KEY" } });
    await waitFor(() => expect(dialog().textContent).toContain("MISSING_KEY: not set."), { timeout: 2000 });
    expect(dialog().textContent).toContain("restart Specquer");
  });

  test("pre-filling warns, and in the shared file asks for confirmation", async () => {
    const { api } = setup();
    await waitFor(() => expect(field("Model ID").value).not.toBe(""));
    openTab("Summarization");
    chooseScope("Shared");
    fireEvent.click(within(dialog()).getByRole("switch", { name: "Pre-fill summaries in the background" }));
    expect(dialog().textContent).toContain("applies to everyone who pulls the change");
    button("Save").click();
    const confirm = await screen.findByRole("dialog", { name: "Pre-fill summaries for everyone?" });
    expect(api.saveAgentSettings).not.toHaveBeenCalled();
    (within(confirm).getByRole("button", { name: "Switch on for everyone" }) as HTMLButtonElement).click();
    await waitFor(() => expect(api.saveAgentSettings).toHaveBeenCalledWith({ scope: "shared", baseVersion: "v-shared", summaries: { prefill: true } }));
  });

  test("a conflict reloads the values and says so", async () => {
    const { api } = setup({ save: async () => ({ kind: "conflict" }) });
    await waitFor(() => expect(field("Model ID").value).not.toBe(""));
    fireEvent.change(field("Model ID"), { target: { value: "other/model" } });
    button("Save").click();
    await waitFor(() => expect(within(dialog()).getByRole("alert").textContent).toContain("changed on disk"));
    expect(api.agentSettings).toHaveBeenCalledTimes(2);
    expect(field("Model ID").value).toBe("google/gemma-4-31b-it");
  });

  test("Test shows the answer time, a problem, and can be cancelled", async () => {
    let answer: (result: ModelTestResult) => void = () => {};
    const { api } = setup({ testModel: () => new Promise((resolve) => (answer = resolve)) });
    await waitFor(() => expect(field("Model ID").value).not.toBe(""));
    fireEvent.change(field("Model ID"), { target: { value: "unsaved/model" } });
    button("Test").click();
    expect((api.testModel.mock.calls[0] as unknown[])[0]).toEqual({ ...MODEL, name: "unsaved/model" });
    await act(async () => answer({ ok: true, ms: 1234 }));
    expect(within(dialog()).getByRole("status").textContent).toBe("The model answered in 1.2 s.");
    button("Test").click();
    await act(async () => answer({ ok: false, problem: "The provider rejected the API key in NVIDIA_API_KEY." }));
    expect(within(dialog()).getByRole("alert").textContent).toContain("rejected the API key");
    fireEvent.click(button("Test"));
    const signal = (api.testModel.mock.calls[2] as unknown as [unknown, AbortSignal])[1];
    fireEvent.click(button("Cancel test"));
    expect(signal.aborted).toBe(true);
  });
});

describe("buildUpdates", () => {
  test("combines both tabs' changes to one file and sends nothing unchanged", () => {
    expect(buildUpdates(SETTINGS, "personal", emptyModelDraft(), "personal", emptySummaryDraft())).toEqual([]);
    const updates = buildUpdates(
      SETTINGS,
      "shared",
      { values: { name: "x/y", baseUrl: MODEL.baseUrl, apiKeyEnv: "K" }, reset: false },
      "shared",
      { values: { tokenBudget: "30,000" }, reset: new Set() },
    );
    expect(updates).toEqual([{ scope: "shared", baseVersion: "v-shared", model: { ...MODEL, name: "x/y", apiKeyEnv: "K" }, summaries: { tokenBudget: 30_000 } }]);
    const split = buildUpdates(SETTINGS, "shared", { values: null, reset: false }, "personal", { values: { prefill: false }, reset: new Set() });
    expect(split).toEqual([{ scope: "personal", baseVersion: "v-personal", summaries: { prefill: false } }]);
  });
});
