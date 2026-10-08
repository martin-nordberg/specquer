import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import type { AnchorFolderResult, SectionProblem, TreeFolder } from "@specquer/shared/api";
import { AnchorDialog } from "./AnchorDialog";
import { ProblemsDialog } from "./ProblemsDialog";
import { SectionBadge } from "./SectionBadge";
import { SectionNotices, noticeText } from "./SectionNotices";

const root: TreeFolder = { kind: "folder", name: "", path: "", children: [] };

describe("SectionBadge", () => {
  test("a badge whose ID is used elsewhere is marked and offers to renumber", async () => {
    const onRenumber = mock(() => {});
    render(
      <SectionBadge
        sectionId="REQ-00007"
        uid="k1v2u0xwq8y7"
        path="docs/b.md"
        problem={{ kind: "duplicate", keeps: false, others: [{ path: "docs/a.md", title: "Rules" }] }}
        onRenumber={onRenumber}
      />,
    );
    const badge = screen.getByRole("button", { name: "Section REQ-00007 (ID used more than once): copy its ID" });
    expect(badge.className).toContain("section-badge-problem");
    act(() => badge.focus());
    await waitFor(() => expect(screen.getAllByText(/Also used by a copy in docs\/a\.md \(“Rules”\)/).length).toBeGreaterThan(0));
    expect(screen.getAllByText("k1v2u0xwq8y7").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Renumber this one" })[0]!);
    expect(onRenumber).toHaveBeenCalled();
  });
});

describe("SectionNotices", () => {
  test("says what a save changed and can be dismissed", () => {
    const onDismiss = mock(() => {});
    const onShowProblems = mock(() => {});
    const notices = [
      { kind: "renumbered" as const, reason: "copy" as const, id: "REQ-00002", newId: "REQ-00009", title: "Copy" },
      { kind: "not-anchored" as const },
    ];
    render(<SectionNotices notices={notices} onDismiss={onDismiss} onShowProblems={onShowProblems} />);
    const status = screen.getByRole("status", { name: "Section changes" });
    expect(status.textContent).toContain("REQ-00002 in “Copy” was a copy of another section and is now REQ-00009.");
    expect(status.textContent).toContain("merge conflict markers");
    fireEvent.click(screen.getByRole("button", { name: "Section problems…" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onShowProblems).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  test("every notice has a sentence", () => {
    expect(noticeText({ kind: "restored", id: "REQ-00099", newId: "REQ-00002", title: "A" })).toContain("REQ-00002 was put back");
    expect(noticeText({ kind: "uid-replaced", id: "REQ-00003", title: "B" })).toContain("got its own");
    for (const reason of ["reused", "unknown-prefix", "duplicate", "collision"] as const) {
      expect(noticeText({ kind: "renumbered", reason, id: "REQ-00001", newId: "REQ-00002", title: "T" })).toContain("REQ-00002");
    }
  });
});

describe("ProblemsDialog", () => {
  test("lists problems, opens files and renumbers occurrences", async () => {
    let problems: SectionProblem[] = [
      {
        kind: "collision",
        id: "REQ-00005",
        occurrences: [
          { path: "docs/a.md", uid: "one", title: "One", keeps: true },
          { path: "docs/b.md", uid: "two", title: "Two", keeps: false },
        ],
      },
      { kind: "stray", path: "docs/c.md", id: "REQ-00008", line: 4 },
      { kind: "conflict-markers", path: "docs/d.md" },
    ];
    const loadProblems = mock(async () => problems);
    const onRenumber = mock(async () => {
      problems = [];
      return null;
    });
    const onOpen = mock(() => {});
    const onClose = mock(() => {});
    render(<ProblemsDialog folder={root} onClose={onClose} loadProblems={loadProblems} onOpen={onOpen} onRenumber={onRenumber} />);
    const list = await screen.findByRole("list", { name: "Problems" });
    expect(list.textContent).toContain("REQ-00005 is used by different sections:");
    expect(list.textContent).toContain("keeps the ID");
    expect(list.textContent).toContain("line 4: the anchor REQ-00008 isn't in a section's place");
    expect(list.textContent).toContain("docs/d.md holds merge conflict markers");
    fireEvent.click(screen.getByRole("button", { name: "Renumber" }));
    await waitFor(() => expect(onRenumber).toHaveBeenCalledWith("docs/b.md", "REQ-00005", "two"));
    await screen.findByText("No problems found.");
    expect(loadProblems).toHaveBeenCalledTimes(2);
  });

  test("opening an occurrence opens the file at the section and closes the dialog", async () => {
    const problems: SectionProblem[] = [
      { kind: "duplicate", id: "REQ-00005", occurrences: [{ path: "docs/a.md", uid: "u", title: "A", keeps: true }, { path: "docs/b.md", uid: "u", title: "A", keeps: false }] },
    ];
    const onOpen = mock(() => {});
    const onClose = mock(() => {});
    render(<ProblemsDialog folder={root} onClose={onClose} loadProblems={async () => problems} onOpen={onOpen} onRenumber={async () => null} />);
    fireEvent.click(await screen.findByRole("button", { name: "docs/b.md" }));
    expect(onOpen).toHaveBeenCalledWith("docs/b.md", "REQ-00005");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("AnchorDialog", () => {
  test("offers the agent guide while AGENTS.md lacks it, and adds it only when ticked", async () => {
    const onRun = mock(async () => null);
    const loadChanges = mock(async (): Promise<AnchorFolderResult> => ({ files: [], agentGuide: false }));
    render(<AnchorDialog folder={root} onClose={() => {}} loadChanges={loadChanges} onRun={onRun} />);
    const box = await screen.findByRole("checkbox", { name: /section anchor rules for coding agents/ });
    expect(screen.queryByRole("button", { name: "Add to AGENTS.md" })).toBeNull();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Add to AGENTS.md" }));
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("", true));
  });

  test("doesn't offer the guide when it is there", async () => {
    const onRun = mock(async () => null);
    render(<AnchorDialog folder={root} onClose={() => {}} loadChanges={async () => ({ files: ["docs/a.md"], agentGuide: true })} onRun={onRun} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add anchors" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("", false));
  });
});
