import { useEffect, useId, useState } from "react";
import type { SectionStatus } from "@specquer/shared/sections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** The section the dialog edits. */
export interface SectionAttributesTarget {
  id: string;
  title: string;
  status: SectionStatus;
  /** The allowed statuses of the section's prefix, in order. */
  allowed: readonly string[];
}

export interface SectionAttributesDialogProps {
  /** The section, or `null` when the dialog is closed. */
  target: SectionAttributesTarget | null;
  onClose: () => void;
  /** Sets the status (`null`: inherited); returns an error message to show, or `null` on success. */
  onApply: (status: string | null) => string | null;
}

const INHERITED = "\u0000inherited";
const INVALID = "\u0000invalid";

/** The choice the dialog starts on: the section's own status, **Inherited**, or its invalid status. */
function initialChoice(status: SectionStatus): string {
  if (status.own === null) return INHERITED;
  return status.canonical ?? INVALID;
}

/**
 * **Section attributes**: the section's status, from **Inherited** (what it would inherit) or
 * the allowed values of its prefix. An invalid status of its own shows as a disabled choice, so
 * the user sees it and picks another. The change is made in the editor's buffer, never on disk.
 */
export function SectionAttributesDialog({ target, onClose, onApply }: SectionAttributesDialogProps) {
  const [choice, setChoice] = useState(INHERITED);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();

  useEffect(() => {
    setError(null);
    if (target !== null) setChoice(initialChoice(target.status));
  }, [target]);

  const apply = () => {
    if (target === null) return;
    // Unchanged, or still the invalid status: nothing to edit
    if (choice === initialChoice(target.status) || choice === INVALID) return onClose();
    const result = onApply(choice === INHERITED ? null : choice);
    if (result === null) onClose();
    else setError(result);
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Section attributes</DialogTitle>
          <DialogDescription>
            {target === null ? "" : `${target.id}${target.title === "" ? "" : ` – ${target.title}`}`}
          </DialogDescription>
        </DialogHeader>
        {target !== null && (
          <form
            className="grid gap-1.5 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            <label htmlFor={selectId} className="font-medium">
              Status
            </label>
            <select
              id={selectId}
              className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value={INHERITED}>Inherited ({target.status.inherited})</option>
              {!target.status.valid && (
                <option value={INVALID} disabled>
                  {target.status.own === "" ? "(blank)" : target.status.own} (not allowed)
                </option>
              )}
              {target.allowed.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </form>
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
          <Button type="button" onClick={apply}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
