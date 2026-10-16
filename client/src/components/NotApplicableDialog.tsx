import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Says why an action from an entry's menu doesn't apply to it (Step 015): every folder and file
 * has the same menu, and this stands in for the action's own dialog.
 */
export function NotApplicableDialog({ notice, onClose }: { notice: { title: string; message: string } | null; onClose: () => void }) {
  return (
    <Dialog open={notice !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{notice?.title}</DialogTitle>
          <DialogDescription>{notice?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
