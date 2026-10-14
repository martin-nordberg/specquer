import { AlertTriangle } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import type { CreateOptions, DeletePreview, FolderSettings, TreeFolder, TreeNode } from "@specquer/shared/api";
import { MARKDOWN_EXTENSION, checkName } from "@specquer/shared/paths";
import { isPrefix } from "@specquer/shared/sections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderFields, type FolderFieldValues, type Inherited, PREFIX_HELP, effectiveSettings, isSectioned, settingFor } from "./settings/FolderFields";

/** Splits a file name into the editable part and its fixed extension. */
export function splitExtension(node: Pick<TreeNode, "kind" | "name">): { stem: string; extension: string } {
  if (node.kind === "folder") return { stem: node.name, extension: "" };
  const dot = node.name.lastIndexOf(".");
  return { stem: node.name.slice(0, dot), extension: node.name.slice(dot) };
}

/**
 * The full name for what was typed: the fixed extension is added, unless the typed name already
 * ends with it (in any case), so "spec.md" or "spec.MD" doesn't become "spec.md.md".
 */
export function nameWithExtension(typed: string, extension: string): string {
  const stem = extension !== "" && typed.toLowerCase().endsWith(extension.toLowerCase()) ? typed.slice(0, -extension.length) : typed;
  return stem + extension;
}

interface NameDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** The name the text box starts with, without the extension. */
  initialName: string;
  /** A fixed extension shown after the text box and added to the name ("" for none). */
  extension: string;
  submitLabel: string;
  /** An id for the error message, unique among open dialogs. */
  errorId: string;
  onClose: () => void;
  /** Performs the action; resolves to an error message to show, or `null` on success. */
  onSubmit: (name: string) => Promise<string | null>;
  /** More fields, below the name. */
  children?: ReactNode;
  /** The other fields hold a problem: the action can't be performed yet. */
  blocked?: boolean;
}

/** A modal dialog with a text box for a file or folder name. */
function NameDialog(props: NameDialogProps) {
  const { open, initialName, extension, errorId, onClose, onSubmit } = props;
  const [value, setValue] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(initialName);
    setError(null);
  }, [open, initialName]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = nameWithExtension(value, extension);
    const check = checkName(name);
    if (!check.ok || name === extension) {
      setError(check.ok ? "The name can't be empty." : check.reason);
      return;
    }
    setBusy(true);
    const result = await onSubmit(name);
    setBusy(false);
    if (result === null) onClose();
    else setError(result);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>{props.description}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1">
            <Input
              aria-label="New name"
              aria-invalid={error !== null}
              aria-describedby={error !== null ? errorId : undefined}
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
            <p id={errorId} role="alert" className="text-sm text-error-text">
              {error}
            </p>
          )}
          {props.children}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || props.blocked === true}>
              {props.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface RenameDialogProps {
  node: TreeNode | null;
  onClose: () => void;
  /** Performs the rename; resolves to an error message to show, or `null` on success. */
  onRename: (node: TreeNode, newName: string) => Promise<string | null>;
}

export function RenameDialog({ node, onClose, onRename }: RenameDialogProps) {
  const { stem, extension } = node === null ? { stem: "", extension: "" } : splitExtension(node);
  return (
    <NameDialog
      open={node !== null}
      title={`Rename ${node?.kind === "folder" ? "folder" : "file"}`}
      description={`Enter a new name for “${node?.name ?? ""}”.`}
      initialName={stem}
      extension={extension}
      submitLabel="Rename"
      errorId="rename-error"
      onClose={onClose}
      onSubmit={async (newName) => {
        if (node === null) return null;
        return newName === node.name ? null : onRename(node, newName);
      }}
    />
  );
}

/** What the create dialog makes, and where. */
export interface CreateRequest {
  parent: TreeFolder;
  kind: "file" | "folder";
}

export interface CreateDialogProps {
  request: CreateRequest | null;
  onClose: () => void;
  /**
   * Performs the create; resolves to an error message to show, or `null` on success. `options`
   * holds only values that differ from the inherited ones, and is left out when there are none.
   */
  onCreate: (request: CreateRequest, name: string, options?: CreateOptions) => Promise<string | null>;
  /** The parent folder's settings, for a new file's prefix and a new folder's type and prefix. */
  loadSettings?: (folder: string) => Promise<FolderSettings>;
}

/**
 * The new file or folder dialog. In a sectioned folder, a new file also gets a prefix for its
 * root section (the folder's default prefix unless changed); a new folder gets a type and a
 * default prefix (inherited unless changed).
 */
export function CreateDialog({ request, onClose, onCreate, loadSettings }: CreateDialogProps) {
  const id = useId();
  const isFile = request?.kind !== "folder";
  const [inherited, setInherited] = useState<Inherited | null>(null);
  const [prefix, setPrefix] = useState("");
  const [values, setValues] = useState<FolderFieldValues>({ folderType: "inherit", prefix: "" });

  useEffect(() => {
    setInherited(null);
    if (request === null || loadSettings === undefined) return;
    let current = true;
    loadSettings(request.parent.path)
      .then((settings) => {
        if (!current) return;
        // A new entry inherits what is in effect for the folder
        const effective = effectiveSettings(settings);
        setInherited(effective);
        setPrefix(effective.defaultPrefix.value ?? "");
        setValues({ folderType: "inherit", prefix: effective.defaultPrefix.value ?? "" });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [request, loadSettings]);

  const sectioned = inherited !== null && isSectioned(inherited);
  let options: CreateOptions = {};
  let problem: string | undefined;
  if (inherited !== null && isFile && sectioned) {
    const typed = prefix.trim();
    if (!isPrefix(typed)) problem = PREFIX_HELP;
    else if (typed !== inherited.defaultPrefix.value) options = { prefix: typed };
  } else if (inherited !== null && !isFile) {
    const result = settingFor(values, inherited);
    problem = result.problem;
    options = {
      ...(result.setting.folderType === "inherit" ? {} : { folderType: result.setting.folderType }),
      ...(result.setting.defaultPrefix === "inherit" ? {} : { prefix: result.setting.defaultPrefix }),
    };
  }

  return (
    <NameDialog
      open={request !== null}
      title={isFile ? "New file" : "New folder"}
      description={`Enter a name for the new ${isFile ? "file" : "folder"} in ${
        request === null || request.parent.path === "" ? "the root folder" : `“${request.parent.name}”`
      }.`}
      initialName=""
      extension={isFile ? MARKDOWN_EXTENSION : ""}
      submitLabel="Create"
      errorId="create-error"
      onClose={onClose}
      blocked={problem !== undefined}
      onSubmit={async (name) => {
        if (request === null) return null;
        return Object.keys(options).length === 0 ? onCreate(request, name) : onCreate(request, name, options);
      }}
    >
      {inherited !== null && isFile && sectioned && (
        <div className="grid gap-1.5 text-sm">
          <Label htmlFor={`${id}-prefix`}>Prefix</Label>
          <Input
            id={`${id}-prefix`}
            className="w-32 font-mono"
            value={prefix}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={problem !== undefined}
            aria-describedby={`${id}-prefix-help`}
            onChange={(event) => setPrefix(event.target.value.toUpperCase())}
          />
          <p id={`${id}-prefix-help`} className={problem === undefined ? "text-xs text-muted-foreground" : "text-xs text-error-text"}>
            {problem ?? "The file's sections get IDs with this prefix, unless a section asks for another."}
          </p>
        </div>
      )}
      {inherited !== null && !isFile && (
        <FolderFields id={id} values={values} inherited={inherited} {...(problem === undefined ? {} : { problem })} onChange={setValues} />
      )}
    </NameDialog>
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
        {/* A file is listed when something goes with it: its comment sidecar (Step 012) */}
        {preview !== null && (isFolder || preview.files.length > 1) && (
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
