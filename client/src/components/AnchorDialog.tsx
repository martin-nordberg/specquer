import { useEffect, useState } from "react";
import type { AnchorFolderResult, TreeNode } from "@specquer/shared/api";
import { AGENT_GUIDE_FILE } from "@specquer/shared/sections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { entryName } from "@/app/entry-actions";

export interface AnchorDialogProps {
  /** The folder or file to add anchors in (Step 015), or `null` when the dialog is closed. */
  target: TreeNode | null;
  onClose: () => void;
  /** The files whose anchors would change (a dry run), and whether `AGENTS.md` has the agent guide. */
  loadChanges: (folder: string) => Promise<AnchorFolderResult>;
  /** Adds the anchors (and the agent guide); resolves to an error message to show, or `null` on success. */
  onRun: (folder: string, addAgentGuide: boolean) => Promise<string | null>;
}

/**
 * **Add section anchors**: shows how many sectioned files in a folder (or whether a file) would
 * change, and lists them, before changing any; or that there are no sectioned files there. While
 * `AGENTS.md` lacks the section anchor rules for coding agents, it also offers, for a folder, to
 * add them; nothing is written there unless the user ticks the box.
 */
export function AnchorDialog({ target, onClose, loadChanges, onRun }: AnchorDialogProps) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [sectioned, setSectioned] = useState(0);
  const [guidePresent, setGuidePresent] = useState(true);
  const [addGuide, setAddGuide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFiles(null);
    setError(null);
    setAddGuide(false);
    if (target === null) return;
    let current = true;
    loadChanges(target.path)
      .then((result) => {
        if (!current) return;
        setFiles(result.files);
        setSectioned(result.sectioned);
        // The rules are for the whole repository: offered when anchoring a folder (Step 015)
        setGuidePresent(target.kind === "file" || result.agentGuide);
      })
      .catch((err: Error) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [target, loadChanges]);

  const run = async () => {
    if (target === null) return;
    setBusy(true);
    const result = await onRun(target.path, addGuide);
    setBusy(false);
    if (result === null) onClose();
    else setError(result);
  };

  const name = target === null ? "" : entryName(target);
  const count = files?.length ?? 0;
  const isFile = target?.kind === "file";
  const unsectioned = isFile
    ? `${name} isn't in a sectioned folder. Section anchors are added only in sectioned folders; see its folder's Settings….`
    : `${target?.path === "" ? "The root folder" : `Folder ${name}`} holds no sectioned files. Section anchors are added only in sectioned folders; see the folder's Settings….`;

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add section anchors</DialogTitle>
          <DialogDescription>
            Add missing section anchors and correct duplicate IDs in {isFile ? name : `the sectioned files in ${name}`}.
          </DialogDescription>
        </DialogHeader>
        {files !== null && (
          <div className="grid gap-2 text-sm">
            <p>{sectioned === 0 ? unsectioned : count === 0 ? (isFile ? "This file needs no changes." : "No file needs to change.") : `${count} ${count === 1 ? "file" : "files"} will change:`}</p>
            {count > 0 && (
              <ul aria-label="Files to change" className="max-h-40 overflow-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                {files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            )}
            {!guidePresent && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={addGuide} onChange={(event) => setAddGuide(event.target.checked)} />
                <span>
                  Also add the section anchor rules for coding agents to <span className="font-mono">{AGENT_GUIDE_FILE}</span>, so agents
                  move anchors with their sections and never invent IDs.
                </span>
              </label>
            )}
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-error-text">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {count === 0 && !addGuide ? "Close" : "Cancel"}
            </Button>
          </DialogClose>
          {(count > 0 || addGuide) && (
            <Button type="button" disabled={busy} onClick={run}>
              {count > 0 ? "Add anchors" : `Add to ${AGENT_GUIDE_FILE}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
