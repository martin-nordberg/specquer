import { Copy, ListChecks } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Where the menu opens and for which section; `returnFocus` gets the focus back when it closes. */
export interface SectionMenuTarget {
  x: number;
  y: number;
  sectionId: string;
  returnFocus?: HTMLElement | null;
}

export interface SectionMenuProps {
  target: SectionMenuTarget | null;
  onClose: () => void;
  onCopy: (sectionId: string) => void;
  /** Opens the section attributes dialog; without it the item isn't shown (a file that isn't sectioned). */
  onAttributes?: (sectionId: string) => void;
  /** Why **Section attributes…** is disabled, if it is (a file with merge conflict markers). */
  attributesDisabled?: string;
}

/**
 * The section badge's menu: **Copy this section ID** and **Section attributes…**. It opens at a
 * point (the right-click, or the badge for the keyboard), so the preview's badges and the WYSIWYG
 * view's (DOM nodes of a ProseMirror node view) share it.
 */
export function SectionMenu({ target, onClose, onCopy, onAttributes, attributesDisabled }: SectionMenuProps) {
  return (
    <DropdownMenu open={target !== null} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" className="pointer-events-none fixed size-0" style={{ left: target?.x ?? 0, top: target?.y ?? 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={target === null ? undefined : `Section ${target.sectionId}`}
        onCloseAutoFocus={(event) => {
          if (target?.returnFocus == null) return;
          event.preventDefault();
          target.returnFocus.focus();
        }}
      >
        <DropdownMenuItem onSelect={() => target !== null && onCopy(target.sectionId)}>
          <Copy aria-hidden="true" />
          Copy this section ID
        </DropdownMenuItem>
        {onAttributes !== undefined &&
          (attributesDisabled === undefined ? (
            <DropdownMenuItem onSelect={() => target !== null && onAttributes(target.sectionId)}>
              <ListChecks aria-hidden="true" />
              Section attributes…
            </DropdownMenuItem>
          ) : (
            // A disabled item takes no pointer events, so its wrapper carries the tooltip
            <div title={attributesDisabled}>
              <DropdownMenuItem disabled aria-description={attributesDisabled}>
                <ListChecks aria-hidden="true" />
                Section attributes…
              </DropdownMenuItem>
            </div>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const CONFLICT_MARKERS_REASON = "This file has merge conflict markers; resolve them first.";

/** Opens the menu from the keyboard: the context-menu key or Shift+F10, at the element's lower left corner. */
export function isMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}
