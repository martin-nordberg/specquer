import { useState } from "react";
import type { SectionInfo } from "@specquer/shared/api";
import { type BadgeStatus, statusLabel } from "@/app/section-status";
import { SectionMenu, type SectionMenuTarget, isMenuKey } from "@/components/SectionMenu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { faviconSvg, svgDataUri } from "@/theme/logo";

const badgeUri = svgDataUri(faviconSvg);

export interface SectionBadgeProps {
  sectionId: string;
  /** The anchor's UID (`data-uid`), if it has one. */
  uid?: string;
  /** The document's workspace path. */
  path: string;
  /** The section's status; `undefined` in a file that isn't sectioned, or before the lists load. */
  status?: BadgeStatus;
  /** Loads the document's sections, for the tooltip's UID when the anchor has none. */
  loadSections?: (path: string) => Promise<SectionInfo[]>;
  /** Set when the ID is also used elsewhere and the user hasn't decided yet. */
  problem?: SectionInfo["problem"];
  /** Gives this occurrence a new number. */
  onRenumber?: () => void;
  /** Opens the section attributes dialog; without it the menu offers only copying. */
  onAttributes?: () => void;
  /** Why **Section attributes…** is disabled, if it is. */
  attributesDisabled?: string;
  /** Called when the menu opens. */
  onMenuOpen?: () => void;
  /** **Add comment…** in the menu (Step 012). */
  onAddComment?: () => void;
  addCommentDisabled?: string;
  /** **Show comments** in the menu, for a section with threads. */
  onShowComments?: () => void;
}

const problemText = { duplicate: "Also used by a copy in", collision: "Also used by another section in" };

/** The badge's accessible name: the section, its status and any problem. */
export function badgeLabel(sectionId: string, status: BadgeStatus | undefined, idProblem: boolean): string {
  const shown = status === undefined ? "" : `, ${statusLabel(status)}`;
  return `Section ${sectionId}${shown}${idProblem ? " (ID used more than once)" : ""}`;
}

/**
 * The badge that stands for a section anchor in the preview: the favicon, focusable, with the
 * section ID and its status, the document path and the section's UID in a tooltip. Right-click
 * (or the context-menu key, or Shift+F10) opens its menu: **Copy this section ID** and
 * **Section attributes…**. A badge whose ID is also used elsewhere, or whose own status isn't
 * allowed, is marked; for an ID used elsewhere, its tooltip names the other occurrences and
 * offers to renumber this one.
 */
export function SectionBadge({
  sectionId,
  uid: anchorUid,
  path,
  status,
  loadSections,
  problem,
  onRenumber,
  onAttributes,
  attributesDisabled,
  onMenuOpen,
  onAddComment,
  addCommentDisabled,
  onShowComments,
}: SectionBadgeProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<SectionMenuTarget | null>(null);
  const [loadedUid, setUid] = useState<string | null | undefined>(undefined);
  const uid = anchorUid ?? loadedUid;

  const onOpenChange = (next: boolean) => {
    setOpen(next && menu === null);
    if (!next) setCopied(false);
    if (next && uid === undefined && loadSections !== undefined) {
      loadSections(path)
        .then((sections) => setUid(sections.find((s) => s.id === sectionId)?.uid ?? null))
        .catch(() => setUid(null));
    }
  };

  const openMenu = (x: number, y: number, element: HTMLElement) => {
    setOpen(false);
    setMenu({ x, y, sectionId, returnFocus: element });
    onMenuOpen?.();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sectionId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    setOpen(true);
  };

  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn("section-badge", (problem !== undefined || status?.invalid === true) && "section-badge-problem")}
            aria-label={badgeLabel(sectionId, status, problem !== undefined)}
            aria-haspopup="menu"
            data-section-id={sectionId}
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(event.clientX, event.clientY, event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (!isMenuKey(event)) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu(rect.left, rect.bottom, event.currentTarget);
            }}
          >
            <img src={badgeUri} alt="" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          {copied ? (
            <p role="status">Copied {sectionId}</p>
          ) : (
            <>
              <p className="font-semibold">
                {sectionId}
                {status !== undefined && ` - ${statusLabel(status)}`}
              </p>
              <p>{path}</p>
              {uid && <p className="text-muted-foreground font-mono">{uid}</p>}
              {problem !== undefined && (
                <div className="mt-1 grid gap-1 border-t pt-1">
                  <p>
                    {problemText[problem.kind]}{" "}
                    {problem.others.map((other) => `${other.path} (“${other.title}”)`).join(", ")}.
                    {problem.keeps ? " This one keeps the ID." : " This one should get a new number."}
                  </p>
                  {onRenumber !== undefined && (
                    <button type="button" className="justify-self-start rounded-sm border px-2 py-0.5 hover:bg-accent" onClick={onRenumber}>
                      Renumber this one
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </TooltipContent>
      </Tooltip>
      <SectionMenu
        target={menu}
        onClose={() => setMenu(null)}
        onCopy={() => void copy()}
        {...(onAttributes === undefined ? {} : { onAttributes: () => onAttributes() })}
        {...(attributesDisabled === undefined ? {} : { attributesDisabled })}
        {...(onAddComment === undefined ? {} : { onAddComment })}
        {...(addCommentDisabled === undefined ? {} : { addCommentDisabled })}
        {...(onShowComments === undefined ? {} : { onShowComments })}
      />
    </TooltipProvider>
  );
}
