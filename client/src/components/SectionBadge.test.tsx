import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import { markdownToHast } from "@specquer/shared/markdown";
import { Preview } from "./Preview";
import { SectionBadge } from "./SectionBadge";

test("the badge is a focusable button that shows the section in a tooltip; its menu copies the ID", async () => {
  const writeText = mock(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const loadSections = mock(async () => [{ id: "REQ-00007", uid: "k1v2u0xwq8y7z6t5s4r3p2o1", kind: "heading" as const, title: "T" }]);
  render(<SectionBadge sectionId="REQ-00007" path="docs/a.md" loadSections={loadSections} />);
  const badge = screen.getByRole("button", { name: "Section REQ-00007" });
  act(() => badge.focus());
  await waitFor(() => expect(screen.getAllByText("docs/a.md").length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getAllByText("k1v2u0xwq8y7z6t5s4r3p2o1").length).toBeGreaterThan(0));
  expect(loadSections).toHaveBeenCalledWith("docs/a.md");
  // A click does nothing any more
  fireEvent.click(badge);
  expect(writeText).not.toHaveBeenCalled();
  fireEvent.contextMenu(badge, { clientX: 10, clientY: 10 });
  const copy = await screen.findByRole("menuitem", { name: "Copy this section ID" });
  // Without a way to edit attributes the menu offers only copying
  expect(screen.queryByRole("menuitem", { name: /Section attributes/ })).toBeNull();
  fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("REQ-00007"));
  await waitFor(() => expect(screen.getAllByText("Copied REQ-00007").length).toBeGreaterThan(0));
});

test("the tooltip and the name show the status: own, inherited or not allowed, which also rings the badge", async () => {
  const { rerender } = render(<SectionBadge sectionId="REQ-00007" path="docs/a.md" status={{ text: "Peer Review", inherited: false, invalid: false }} />);
  let badge = screen.getByRole("button", { name: "Section REQ-00007, Peer Review" });
  act(() => badge.focus());
  await waitFor(() => expect(screen.getAllByText("REQ-00007 - Peer Review").length).toBeGreaterThan(0));
  rerender(<SectionBadge sectionId="REQ-00007" path="docs/a.md" status={{ text: "Draft", inherited: true, invalid: false }} />);
  badge = screen.getByRole("button", { name: "Section REQ-00007, Draft (inherited)" });
  expect(badge.className).not.toContain("section-badge-problem");
  rerender(<SectionBadge sectionId="REQ-00007" path="docs/a.md" status={{ text: "Revieww", inherited: false, invalid: true }} />);
  badge = screen.getByRole("button", { name: "Section REQ-00007, Revieww (not allowed)" });
  expect(badge.className).toContain("section-badge-problem");
});

test("the keyboard opens the menu: the context-menu key and Shift+F10", async () => {
  const onAttributes = mock(() => {});
  render(<SectionBadge sectionId="REQ-00007" path="docs/a.md" onAttributes={onAttributes} />);
  const badge = screen.getByRole("button", { name: "Section REQ-00007" });
  fireEvent.keyDown(badge, { key: "F10", shiftKey: true });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Section attributes…" }));
  expect(onAttributes).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  fireEvent.keyDown(badge, { key: "ContextMenu" });
  expect(await screen.findByRole("menuitem", { name: "Copy this section ID" })).toBeDefined();
});

test("Section attributes… is disabled, with the reason, in a file with conflict markers", async () => {
  render(<SectionBadge sectionId="REQ-00007" path="docs/a.md" onAttributes={() => {}} attributesDisabled="This file has merge conflict markers; resolve them first." />);
  fireEvent.contextMenu(screen.getByRole("button", { name: "Section REQ-00007" }));
  const item = await screen.findByRole("menuitem", { name: "Section attributes…" });
  expect(item.getAttribute("aria-disabled")).toBe("true");
  expect(item.parentElement?.getAttribute("title")).toBe("This file has merge conflict markers; resolve them first.");
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

describe("statuses in the preview", () => {
  const body = [
    '<a id="REQ-00001" data-uid="k1v2u0xwq8y7"></a>',
    "",
    '<a id="REQ-00002" data-uid="k1v2u0xwq8y8" data-status="Testing"></a>',
    "# Design",
    "",
    '<a id="REQ-00003" data-uid="k1v2u0xwq8y9"></a>',
    "## Detail",
    "",
    '<a id="REQ-00004" data-uid="k1v2u0xwq8ya" data-status="Revieww"></a>',
    "## Odd",
    "",
  ].join("\n");
  const lists = { sectioned: true, folderPrefix: "REQ", statusValues: { REQ: ["Draft", "Testing", "Done"] } };

  test("badges show each section's status, and the dialog sets one through onSetStatus", async () => {
    const onSetStatus = mock((_id: string, _uid: string | null, _status: string | null) => null);
    render(<Preview markdown={body} currentFile="docs/a.md" onOpenFile={() => {}} statusLists={lists} onSetStatus={onSetStatus} />);
    expect(await screen.findByRole("button", { name: "Section REQ-00001, Draft (inherited)" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Section REQ-00002, Testing" })).toBeDefined();
    const detail = screen.getByRole("button", { name: "Section REQ-00003, Testing (inherited)" });
    expect(screen.getByRole("button", { name: "Section REQ-00004, Revieww (not allowed)" }).className).toContain("section-badge-problem");
    fireEvent.contextMenu(detail);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Section attributes…" }));
    const select = (await screen.findByRole("combobox", { name: "Status" })) as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(["Inherited (Testing)", "Draft", "Testing", "Done"]);
    fireEvent.change(select, { target: { value: "Done" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onSetStatus).toHaveBeenCalledWith("REQ-00003", "k1v2u0xwq8y9", "Done");
  });

  test("a file that isn't sectioned shows no status and offers only copying", async () => {
    render(
      <Preview markdown={body} currentFile="notes/a.md" onOpenFile={() => {}} statusLists={{ sectioned: false, folderPrefix: null, statusValues: {} }} onSetStatus={() => null} />,
    );
    const badge = await screen.findByRole("button", { name: "Section REQ-00002" });
    fireEvent.contextMenu(badge);
    expect(await screen.findByRole("menuitem", { name: "Copy this section ID" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: /Section attributes/ })).toBeNull();
  });

  test("Section attributes… is disabled in a file with conflict markers", async () => {
    const conflicted = `${body}<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n`;
    render(<Preview markdown={conflicted} currentFile="docs/a.md" onOpenFile={() => {}} statusLists={lists} onSetStatus={() => null} />);
    fireEvent.contextMenu(await screen.findByRole("button", { name: "Section REQ-00002, Testing" }));
    expect((await screen.findByRole("menuitem", { name: "Section attributes…" })).getAttribute("aria-disabled")).toBe("true");
  });
});
