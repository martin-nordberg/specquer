import { useCallback, useEffect, useState } from "react";
import type { SectionProblem, SectionProblemsResult, TreeNode } from "@specquer/shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { entryName } from "@/app/entry-actions";

export interface ProblemsDialogProps {
  /** The folder or file to check (Step 015), or `null` when the dialog is closed. */
  target: TreeNode | null;
  onClose: () => void;
  loadProblems: (path: string) => Promise<SectionProblemsResult>;
  /** Opens a file, at a section if given. */
  onOpen: (path: string, sectionId?: string) => void;
  /** Renumbers one occurrence; resolves to an error message, or `null` on success. */
  onRenumber: (path: string, id: string, uid: string | null) => Promise<string | null>;
  /** Renumbers a whole file as a copy of another document; resolves as `onRenumber` does. */
  onRenumberDocument: (path: string) => Promise<string | null>;
}

const linkClass = "rounded-sm font-mono text-xs underline outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * **Section problems**: nested Specquer folders, whole files copied with no known original, duplicate and colliding
 * section IDs waiting for the user, unusable prefix settings, stray anchors, files with merge
 * conflict markers, and statuses that aren't allowed, in a folder's sectioned files.
 */
export function ProblemsDialog({ target, onClose, loadProblems, onOpen, onRenumber, onRenumberDocument }: ProblemsDialogProps) {
  const [problems, setProblems] = useState<SectionProblem[] | null>(null);
  const [sectioned, setSectioned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (target === null) return;
    try {
      const result = await loadProblems(target.path);
      setProblems(result.problems);
      setSectioned(result.sectioned);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [target, loadProblems]);

  useEffect(() => {
    setProblems(null);
    setError(null);
    void reload();
  }, [reload]);

  const open = (path: string, sectionId?: string) => {
    onOpen(path, sectionId);
    onClose();
  };

  const renumber = async (path: string, id: string | null, uid: string | null) => {
    setBusy(true);
    const result = id === null ? await onRenumberDocument(path) : await onRenumber(path, id, uid);
    setBusy(false);
    setError(result);
    await reload();
  };

  const describe = (problem: SectionProblem) => {
    switch (problem.kind) {
      case "nested-specquer":
        return (
          <p>
            <span className="font-mono text-xs">{problem.folder}/.specquer/</span> belongs to another Specquer inside this one. Its section
            data is ignored here, and Specquer won't start in {problem.folder}. Check its section IDs, then delete it.
          </p>
        );
      case "copied-document":
        return (
          <>
            <p>These files are copies of one document, and Specquer can't tell which is the original. Renumber the copy; until then neither file gets anchors.</p>
            <ul className="grid gap-1 pl-4">
              {problem.paths.map((path) => (
                <li key={path} className="flex flex-wrap items-center gap-2">
                  <button type="button" className={linkClass} onClick={() => open(path)}>
                    {path}
                  </button>
                  <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void renumber(path, null, null)}>
                    Renumber this copy
                  </Button>
                </li>
              ))}
            </ul>
          </>
        );
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
      case "invalid-status":
        return (
          <p>
            <button type="button" className={linkClass} onClick={() => open(problem.path, problem.id)}>
              {problem.path}
            </button>
            , line {problem.line}: {problem.id}'s status {problem.value === "" ? "is blank" : `“${problem.value}” isn't allowed for ${problem.prefix}`}.
          </p>
        );
      case "prefix-config":
        return (
          <p>
            <span className="font-mono text-xs">{problem.path}</span>: {problem.message}, so {problem.prefix} uses the default statuses.
          </p>
        );
      case "comment-sidecar":
        return (
          <p>
            <span className="font-mono text-xs">{problem.path}</span>: {problem.message} Its comment threads aren't shown or changed until it is
            fixed.
          </p>
        );
      case "orphaned-sidecar":
        return (
          <p>
            <span className="font-mono text-xs">{problem.path}</span> holds comment threads, but its document isn't beside it. Move or rename
            it with its document, or delete it.
          </p>
        );
      case "detached-thread":
        return (
          <p>
            <button type="button" className={linkClass} onClick={() => open(problem.path)}>
              {problem.path}
            </button>
            : the section of the thread “{problem.text}” is no longer in the document. It is listed as detached in the Comments pane.
          </p>
        );
    }
  };

  const name = target === null ? "" : entryName(target);
  const unsectioned =
    target?.kind === "file"
      ? `${name} isn't in a sectioned folder, so it has no section anchors to check.`
      : `${target?.path === "" ? "The root folder" : `Folder ${name}`} holds no sectioned files, so it has no section anchors to check.`;

  return (
    <Dialog open={target !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Section problems</DialogTitle>
          <DialogDescription>Section anchors in {name} that need a decision.</DialogDescription>
        </DialogHeader>
        {/* Problems that need no sectioned files, such as a nested Specquer folder, are still listed */}
        {problems !== null && sectioned === 0 && (
          <p className="text-sm">
            {unsectioned}
          </p>
        )}
        {problems !== null && problems.length === 0 && sectioned > 0 && <p className="text-sm">No problems found.</p>}
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
