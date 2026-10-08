import { useEffect, useState } from "react";
import type { AnchorFolderResult, TreeFolder } from "@specquer/shared/api";
import { AGENT_GUIDE_FILE } from "@specquer/shared/sections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface AnchorDialogProps {
  /** The folder to add anchors in, or `null` when the dialog is closed. */
  folder: TreeFolder | null;
  onClose: () => void;
  /** The files whose anchors would change (a dry run), and whether `AGENTS.md` has the agent guide. */
  loadChanges: (folder: string) => Promise<AnchorFolderResult>;
  /** Adds the anchors (and the agent guide); resolves to an error message to show, or `null` on success. */
  onRun: (folder: string, addAgentGuide: boolean) => Promise<string | null>;
}

/**
 * **Add section anchors**: shows how many sectioned files in a folder would change, and lists
 * them, before changing any. While `AGENTS.md` lacks the section anchor rules for coding agents,
 * it also offers to add them; nothing is written there unless the user ticks the box.
 */
export function AnchorDialog({ folder, onClose, loadChanges, onRun }: AnchorDialogProps) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [guidePresent, setGuidePresent] = useState(true);
  const [addGuide, setAddGuide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFiles(null);
    setError(null);
    setAddGuide(false);
    if (folder === null) return;
    let current = true;
    loadChanges(folder.path)
      .then((result) => {
        if (!current) return;
        setFiles(result.files);
        setGuidePresent(result.agentGuide);
      })
      .catch((err: Error) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [folder, loadChanges]);

  const run = async () => {
    if (folder === null) return;
    setBusy(true);
    const result = await onRun(folder.path, addGuide);
    setBusy(false);
    if (result === null) onClose();
    else setError(result);
  };

  const name = folder === null ? "" : folder.path === "" ? "the root folder" : `“${folder.name}”`;
  const count = files?.length ?? 0;

  return (
    <Dialog open={folder !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add section anchors</DialogTitle>
          <DialogDescription>Add missing section anchors and correct duplicate IDs in the sectioned files in {name}.</DialogDescription>
        </DialogHeader>
        {files !== null && (
          <div className="grid gap-2 text-sm">
            <p>{count === 0 ? "No file needs to change." : `${count} ${count === 1 ? "file" : "files"} will change:`}</p>
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
