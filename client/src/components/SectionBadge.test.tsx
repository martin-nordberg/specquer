import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, mock, test } from "bun:test";
import { markdownToHast } from "@specquer/shared/markdown";
import { Preview } from "./Preview";
import { SectionBadge } from "./SectionBadge";

test("the badge is a focusable button that shows the section in a tooltip and copies its ID", async () => {
  const writeText = mock(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const loadSections = mock(async () => [{ id: "REQ-00007", uid: "k1v2u0xwq8y7z6t5s4r3p2o1", kind: "heading" as const, title: "T" }]);
  render(<SectionBadge sectionId="REQ-00007" path="docs/a.md" loadSections={loadSections} />);
  const badge = screen.getByRole("button", { name: "Section REQ-00007: copy its ID" });
  act(() => badge.focus());
  await waitFor(() => expect(screen.getAllByText("docs/a.md").length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getAllByText("k1v2u0xwq8y7z6t5s4r3p2o1").length).toBeGreaterThan(0));
  expect(loadSections).toHaveBeenCalledWith("docs/a.md");
  fireEvent.click(badge);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("REQ-00007"));
  await waitFor(() => expect(screen.getAllByText("Copied REQ-00007").length).toBeGreaterThan(0));
});

test("the preview shows badges for section anchors only", async () => {
  const markdown =
    '<a id="REQ-00001" data-document-id="tz4a98xxat96iws9zmbrgj3a"></a>\n\n<a id="REQ-00002"></a>\n# Title\n\n* <a id="REQ-00003"></a> item\n\n> <a id="REQ-00004"></a> quoted\n';
  expect(markdownToHast(markdown).children.length).toBeGreaterThan(0);
  render(<Preview markdown={markdown} currentFile="docs/a.md" onOpenFile={() => {}} />);
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^Section / })).toHaveLength(3));
  const heading = screen.getByRole("heading", { name: /Title/ });
  expect(heading.querySelector("[data-section-id='REQ-00002']")).not.toBeNull();
  // The anchors stay, invisible, for scrolling
  expect(document.getElementById("user-content-REQ-00002")).not.toBeNull();
});
