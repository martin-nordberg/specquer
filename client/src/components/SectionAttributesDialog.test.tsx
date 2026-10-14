import { fireEvent, render, screen } from "@testing-library/react";
import { expect, mock, test } from "bun:test";
import { DEFAULT_STATUS_VALUES, type SectionStatus } from "@specquer/shared/sections";
import { SectionAttributesDialog } from "./SectionAttributesDialog";

const status = (own: string | null, canonical?: string): SectionStatus => ({
  prefix: "REQ",
  own,
  ...(canonical === undefined ? {} : { canonical }),
  valid: own === null || canonical !== undefined,
  inherited: "Testing",
  effective: own === null ? "Testing" : (canonical ?? null),
});
const target = (s: SectionStatus) => ({ id: "REQ-00002", title: "Design", status: s, allowed: DEFAULT_STATUS_VALUES });
const select = () => screen.getByRole("combobox", { name: "Status" }) as HTMLSelectElement;
const options = () => [...select().options].map((option) => `${option.text}${option.disabled ? " [disabled]" : ""}`);

test("the choices: Inherited with what it resolves to, then the allowed values in order", () => {
  const onApply = mock((_status: string | null) => null);
  render(<SectionAttributesDialog target={target(status(null))} onClose={() => {}} onApply={onApply} />);
  expect(screen.getByText("REQ-00002 – Design")).toBeDefined();
  expect(options()).toEqual(["Inherited (Testing)", ...DEFAULT_STATUS_VALUES]);
  expect(select().selectedOptions[0]!.text).toBe("Inherited (Testing)");
  fireEvent.change(select(), { target: { value: "Approved" } });
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(onApply).toHaveBeenCalledWith("Approved");
});

test("an own status starts selected; Inherited removes it; OK without a change edits nothing", () => {
  const onApply = mock((_status: string | null) => null);
  const onClose = mock(() => {});
  const { rerender } = render(<SectionAttributesDialog target={target(status("peer review", "Peer Review"))} onClose={onClose} onApply={onApply} />);
  expect(select().selectedOptions[0]!.text).toBe("Peer Review");
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(onApply).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
  rerender(<SectionAttributesDialog target={target(status("Testing", "Testing"))} onClose={onClose} onApply={onApply} />);
  fireEvent.change(select(), { target: { value: select().options[0]!.value } });
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(onApply).toHaveBeenCalledWith(null);
});

test("an invalid status shows as a disabled choice, selected at first; confirming it changes nothing", () => {
  const onApply = mock((_status: string | null) => null);
  render(<SectionAttributesDialog target={target(status("Revieww"))} onClose={() => {}} onApply={onApply} />);
  expect(options()).toEqual(["Inherited (Testing)", "Revieww (not allowed) [disabled]", ...DEFAULT_STATUS_VALUES]);
  expect(select().selectedOptions[0]!.text).toBe("Revieww (not allowed)");
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(onApply).not.toHaveBeenCalled();
});

test("an error from applying is shown and the dialog stays open", () => {
  const onClose = mock(() => {});
  render(<SectionAttributesDialog target={target(status(null))} onClose={onClose} onApply={() => "REQ-00002 is no longer in the file."} />);
  fireEvent.change(select(), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.getByRole("alert").textContent).toBe("REQ-00002 is no longer in the file.");
  expect(onClose).not.toHaveBeenCalled();
});
