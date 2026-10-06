import { AlertTriangle } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { DeletePreview, TreeNode } from "@specquer/shared/api";
import { checkName } from "@specquer/shared/paths";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Splits a file name into the editable part and its fixed extension. */
export function splitExtension(node: Pick<TreeNode, "kind" | "name">): { stem: string; extension: string } {
  if (node.kind === "folder") return { stem: node.name, extension: "" };
  const dot = node.name.lastIndexOf(".");
  return { stem: node.name.slice(0, dot), extension: node.name.slice(dot) };
}

export interface RenameDialogProps {
  node: TreeNode | null;
  onClose: () => void;
  /** Performs the rename; resolves to an error message to show, or `null` on success. */
  onRename: (node: TreeNode, newName: string) => Promise<string | null>;
}

export function RenameDialog({ node, onClose, onRename }: RenameDialogProps) {
  const { stem, extension } = node === null ? { stem: "", extension: "" } : splitExtension(node);
  const [value, setValue] = useState(stem);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(stem);
    setError(null);
  }, [node, stem]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (node === null) return;
    const newName = value + extension;
    const check = checkName(newName);
    if (!check.ok || value === "") {
      setError(check.ok ? "The name can't be empty." : check.reason);
      return;
    }
    if (newName === node.name) {
      onClose();
      return;
    }
    setBusy(true);
    const result = await onRename(node, newName);
    setBusy(false);
    if (result === null) onClose();
    else setError(result);
  };

  return (
    <Dialog open={node !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename {node?.kind === "folder" ? "folder" : "file"}</DialogTitle>
            <DialogDescription>Enter a new name for “{node?.name}”.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1">
            <Input
              aria-label="New name"
              aria-invalid={error !== null}
              aria-describedby={error !== null ? "rename-error" : undefined}
              value={value}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
            {extension !== "" && <span className="text-muted-foreground">{extension}</span>}
          </div>
          {error !== null && (
            <p id="rename-error" role="alert" className="text-sm text-error-text">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface DeleteDialogProps {
  node: TreeNode | null;
  onClose: () => void;
  loadPreview: (path: string) => Promise<DeletePreview>;
  /** Performs the delete; resolves to an error message to show, or `null` on success. */
  onDelete: (node: TreeNode) => Promise<string | null>;
}

export function DeleteDialog({ node, onClose, loadPreview, onDelete }: DeleteDialogProps) {
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (node === null) return;
    let current = true;
    loadPreview(node.path)
      .then((result) => current && setPreview(result))
      .catch((err: Error) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [node, loadPreview]);

  const confirm = async () => {
    if (node === null) return;
    setBusy(true);
    const result = await onDelete(node);
    setBusy(false);
    if (result === null) onClose();
    else setError(result);
  };

  const isFolder = node?.kind === "folder";
  const uncommitted = preview?.uncommitted;
  const hidden = preview === null ? 0 : preview.files.filter((f) => !f.toLowerCase().endsWith(".md")).length;

  return (
    <Dialog open={node !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {isFolder ? "folder" : "file"}</DialogTitle>
          <DialogDescription>
            Delete “{node?.name}”{isFolder ? " and everything in it" : ""}? This can't be undone in Specquer.
          </DialogDescription>
        </DialogHeader>
        {isFolder && preview !== null && (
          <div className="grid gap-2 text-sm">
            <p>
              {preview.fileCount === 0
                ? "The folder is empty."
                : `${preview.fileCount} ${preview.fileCount === 1 ? "file" : "files"} will be deleted${hidden > 0 ? `, including ${hidden} not shown in the tree` : ""}:`}
            </p>
            {preview.files.length > 0 && (
              <ul aria-label="Files to delete" className="max-h-40 overflow-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                {preview.files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
                {preview.fileCount > preview.files.length && <li>… and {preview.fileCount - preview.files.length} more</li>}
              </ul>
            )}
          </div>
        )}
        {preview !== null && (uncommitted === null || (uncommitted !== undefined && uncommitted.length > 0)) && (
          <div role="alert" className="flex gap-2 rounded-md bg-warning px-3 py-2 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {uncommitted === null ? (
              <p>This folder isn't in a Git repository, so deleted files can't be recovered from Git.</p>
            ) : (
              <div>
                <p>{uncommitted.length === 1 ? "1 file isn't" : `${uncommitted.length} files aren't`} committed to Git and can't be recovered:</p>
                <ul className="mt-1 max-h-24 overflow-auto font-mono text-xs">
                  {uncommitted.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </div>
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
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" disabled={busy || (preview === null && error === null)} onClick={confirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
