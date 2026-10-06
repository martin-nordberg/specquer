import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Shown when a save finds that the file changed on disk since it was opened (decision D8). */
export function ConflictDialog({
  path,
  open,
  onReloadTheirs,
  onKeepMine,
}: {
  path: string;
  open: boolean;
  onReloadTheirs: () => void;
  onKeepMine: () => void;
}) {
  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>The file changed on disk</DialogTitle>
          <DialogDescription>
            “{path}” was changed outside Specquer (for example by a coding agent) after you opened it. Your changes haven't been
            saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onReloadTheirs}>
            Reload from disk
          </Button>
          <Button onClick={onKeepMine}>Keep my version</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
