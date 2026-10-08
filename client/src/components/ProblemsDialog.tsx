import { useCallback, useEffect, useState } from "react";
import type { SectionProblem, TreeFolder } from "@specquer/shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface ProblemsDialogProps {
  /** The folder to check, or `null` when the dialog is closed. */
  folder: TreeFolder | null;
  onClose: () => void;
  loadProblems: (folder: string) => Promise<SectionProblem[]>;
  /** Opens a file, at a section if given. */
  onOpen: (path: string, sectionId?: string) => void;
  /** Renumbers one occurrence; resolves to an error message, or `null` on success. */
  onRenumber: (path: string, id: string, uid: string | null) => Promise<string | null>;
}

const linkClass = "rounded-sm font-mono text-xs underline outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * **Section problems**: duplicate and colliding section IDs waiting for the user, stray anchors,
 * and files with merge conflict markers, in a folder's sectioned files.
 */
export function ProblemsDialog({ folder, onClose, loadProblems, onOpen, onRenumber }: ProblemsDialogProps) {
  const [problems, setProblems] = useState<SectionProblem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (folder === null) return;
    try {
      setProblems(await loadProblems(folder.path));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [folder, loadProblems]);

  useEffect(() => {
    setProblems(null);
    setError(null);
    void reload();
  }, [reload]);

  const open = (path: string, sectionId?: string) => {
    onOpen(path, sectionId);
    onClose();
  };

  const renumber = async (path: string, id: string, uid: string | null) => {
    setBusy(true);
    const result = await onRenumber(path, id, uid);
    setBusy(false);
    setError(result);
    await reload();
  };

  const describe = (problem: SectionProblem) => {
    switch (problem.kind) {
      case "duplicate":
      case "collision":
        return (
          <>
            <p>
              <span className="font-semibold">{problem.id}</span>{" "}
              {problem.kind === "duplicate" ? "is used by copies of one section:" : "is used by different sections:"}
            </p>
            <ul className="grid gap-1 pl-4">
              {problem.occurrences.map((o) => (
                <li key={`${o.path}:${o.uid}`} className="flex flex-wrap items-center gap-2">
                  <button type="button" className={linkClass} onClick={() => open(o.path, problem.id)}>
                    {o.path}
                  </button>
                  <span>“{o.title}”</span>
                  {o.keeps ? (
                    <span className="text-muted-foreground">keeps the ID</span>
                  ) : (
                    <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void renumber(o.path, problem.id, o.uid)}>
                      Renumber
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        );
      case "stray":
        return (
          <p>
            <button type="button" className={linkClass} onClick={() => open(problem.path)}>
              {problem.path}
            </button>
            , line {problem.line}: the anchor {problem.id} isn't in a section's place, so it no longer marks a section.
          </p>
        );
      case "conflict-markers":
        return (
          <p>
            <button type="button" className={linkClass} onClick={() => open(problem.path)}>
              {problem.path}
            </button>{" "}
            holds merge conflict markers; its anchors are left alone until they are resolved.
          </p>
        );
    }
  };

  const name = folder === null ? "" : folder.path === "" ? "the root folder" : `“${folder.name}”`;

  return (
    <Dialog open={folder !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Section problems</DialogTitle>
          <DialogDescription>Section anchors in {name} that need a decision.</DialogDescription>
        </DialogHeader>
        {problems !== null && problems.length === 0 && <p className="text-sm">No problems found.</p>}
        {problems !== null && problems.length > 0 && (
          <ul aria-label="Problems" className="grid max-h-80 gap-3 overflow-auto text-sm">
            {problems.map((problem, index) => (
              <li key={index} className="grid gap-1">
                {describe(problem)}
              </li>
            ))}
          </ul>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-error-text">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
