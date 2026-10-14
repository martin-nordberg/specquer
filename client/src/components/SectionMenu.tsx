import { Copy, ListChecks, MessageSquarePlus, MessagesSquare } from "lucide-react";
import { useRef } from "react";
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
  /** Starts a comment thread on the section (Step 012); without it the item isn't shown. */
  onAddComment?: () => void;
  /** Why **Add comment…** is disabled, if it is (a section without a UID yet). */
  addCommentDisabled?: string;
  /** Opens the Comments pane at the section's threads; without it (no threads) the item isn't shown. */
  onShowComments?: () => void;
}

/**
 * The section badge's menu: **Copy this section ID**, **Section attributes…** and, for comment
 * threads, **Add comment…** and **Show comments**. It opens at a
 * point (the right-click, or the badge for the keyboard), so the preview's badges and the WYSIWYG
 * view's (DOM nodes of a ProseMirror node view) share it.
 */
export function SectionMenu({ target, onClose, onCopy, onAttributes, attributesDisabled, onAddComment, addCommentDisabled, onShowComments }: SectionMenuProps) {
  // The comment items move the focus to the Comments pane, which keeps it
  const keepFocus = useRef(false);
  return (
    <DropdownMenu open={target !== null} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" className="pointer-events-none fixed size-0" style={{ left: target?.x ?? 0, top: target?.y ?? 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={target === null ? undefined : `Section ${target.sectionId}`}
        onCloseAutoFocus={(event) => {
          if (keepFocus.current) {
            keepFocus.current = false;
            event.preventDefault();
            return;
          }
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
        {onAddComment !== undefined &&
          (addCommentDisabled === undefined ? (
            <DropdownMenuItem
              onSelect={() => {
                keepFocus.current = true;
                onAddComment();
              }}
            >
              <MessageSquarePlus aria-hidden="true" />
              Add comment…
            </DropdownMenuItem>
          ) : (
            <div title={addCommentDisabled}>
              <DropdownMenuItem disabled aria-description={addCommentDisabled}>
                <MessageSquarePlus aria-hidden="true" />
                Add comment…
              </DropdownMenuItem>
            </div>
          ))}
        {onShowComments !== undefined && (
          <DropdownMenuItem
            onSelect={() => {
              keepFocus.current = true;
              onShowComments();
            }}
          >
            <MessagesSquare aria-hidden="true" />
            Show comments
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const CONFLICT_MARKERS_REASON = "This file has merge conflict markers; resolve them first.";

/** Opens the menu from the keyboard: the context-menu key or Shift+F10, at the element's lower left corner. */
export function isMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}
