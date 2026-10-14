import { fireEvent, render, screen } from "@testing-library/react";
import { expect, mock, test } from "bun:test";
import { PaneLayout } from "./PaneLayout";

function setup(props: { treeFraction?: number; chatFraction?: number; chatOpen?: boolean } = {}) {
  const onTreeFractionChange = mock((_fraction: number) => {});
  const onChatFractionChange = mock((_fraction: number) => {});
  render(
    <PaneLayout
      treeFraction={props.treeFraction ?? 0.25}
      rightFraction={props.chatFraction ?? 0.3}
      rightOpen={props.chatOpen ?? true}
      onTreeFractionChange={onTreeFractionChange}
      onRightFractionChange={onChatFractionChange}
      left={<div>folders</div>}
      center={<div>file</div>}
      right={<div>chat</div>}
    />,
  );
  return { onTreeFractionChange, onChatFractionChange };
}

test("the chat pane shows only when open, with its own drag bar", () => {
  setup({ chatOpen: false });
  expect(screen.queryByText("chat")).toBeNull();
  expect(screen.queryByRole("separator", { name: "Resize the chat pane" })).toBeNull();
  expect(screen.getByRole("separator", { name: "Resize the folder pane" })).toBeDefined();
});

test("both bars move with the arrow keys; dragging the chat bar left widens the chat", () => {
  const { onTreeFractionChange, onChatFractionChange } = setup();
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize the folder pane" }), { key: "ArrowRight" });
  expect(onTreeFractionChange.mock.calls[0]![0]).toBeCloseTo(0.27);
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize the chat pane" }), { key: "ArrowLeft" });
  expect(onChatFractionChange.mock.calls[0]![0]).toBeCloseTo(0.32);
});

test("the file pane keeps 30%: a pane stops growing there, the chat pane giving way first", () => {
  const { onTreeFractionChange, onChatFractionChange } = setup({ treeFraction: 0.4, chatFraction: 0.3 });
  const chatBar = screen.getByRole("separator", { name: "Resize the chat pane" });
  expect(chatBar.getAttribute("aria-valuenow")).toBe("30");
  expect(chatBar.getAttribute("aria-valuemax")).toBe("30");
  fireEvent.keyDown(chatBar, { key: "ArrowLeft" });
  expect(onChatFractionChange.mock.calls[0]![0]).toBeCloseTo(0.3);
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize the folder pane" }), { key: "ArrowRight" });
  expect(onTreeFractionChange.mock.calls[0]![0]).toBeCloseTo(0.4);
});

test("stored widths too wide together are shown narrower, the chat first", () => {
  setup({ treeFraction: 0.6, chatFraction: 0.5 });
  expect(screen.getByRole("separator", { name: "Resize the chat pane" }).getAttribute("aria-valuenow")).toBe("15");
  expect(screen.getByRole("separator", { name: "Resize the folder pane" }).getAttribute("aria-valuenow")).toBe("55");
});
