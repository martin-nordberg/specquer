import { useEffect, useState } from "react";
import type { TreeFolder } from "@specquer/shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface AnchorDialogProps {
  /** The folder to add anchors in, or `null` when the dialog is closed. */
  folder: TreeFolder | null;
  onClose: () => void;
  /** The files whose anchors would change (a dry run). */
  loadChanges: (folder: string) => Promise<string[]>;
  /** Adds the anchors; resolves to an error message to show, or `null` on success. */
  onRun: (folder: string) => Promise<string | null>;
}

/**
 * **Add section anchors**: shows how many sectioned files in a folder would change, and lists
 * them, before changing any.
 */
export function AnchorDialog({ folder, onClose, loadChanges, onRun }: AnchorDialogProps) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFiles(null);
    setError(null);
    if (folder === null) return;
    let current = true;
    loadChanges(folder.path)
      .then((result) => current && setFiles(result))
      .catch((err: Error) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [folder, loadChanges]);

  const run = async () => {
    if (folder === null) return;
    setBusy(true);
    const result = await onRun(folder.path);
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
              {count === 0 ? "Close" : "Cancel"}
            </Button>
          </DialogClose>
          {count > 0 && (
            <Button type="button" disabled={busy} onClick={run}>
              Add anchors
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
