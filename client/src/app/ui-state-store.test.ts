import { expect, mock, test } from "bun:test";
import { defaultUiState, openFile, setTheme } from "@specquer/shared/uistate";
import type { Api } from "@/lib/api";
import { UiStateStore } from "./ui-state-store";

test("changes apply at once and are sent as one patch", async () => {
  const patchUiState = mock(async () => defaultUiState());
  const store = new UiStateStore({ patchUiState } as unknown as Api, defaultUiState());
  const listener = mock(() => {});
  store.subscribe(listener);
  store.update((s) => openFile(s, "a.md"));
  store.update((s) => setTheme(s, "dark"));
  expect(store.get()).toMatchObject({ currentFile: "a.md", theme: "dark" });
  expect(listener).toHaveBeenCalledTimes(2);
  await store.flush();
  expect(patchUiState).toHaveBeenCalledTimes(1);
  expect(patchUiState.mock.calls[0]).toEqual([{ currentFile: "a.md", theme: "dark" }, undefined] as never);
  await store.flush();
  expect(patchUiState).toHaveBeenCalledTimes(1);
});

test("reset replaces the state without sending it back", async () => {
  const patchUiState = mock(async () => defaultUiState());
  const store = new UiStateStore({ patchUiState } as unknown as Api, defaultUiState());
  store.reset(openFile(defaultUiState(), "b.md"));
  expect(store.get().currentFile).toBe("b.md");
  await store.flush();
  expect(patchUiState).not.toHaveBeenCalled();
});
