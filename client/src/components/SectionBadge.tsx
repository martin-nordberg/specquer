import { useState } from "react";
import type { SectionInfo } from "@specquer/shared/api";
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
  /** Loads the document's sections, for the tooltip's UID when the anchor has none. */
  loadSections?: (path: string) => Promise<SectionInfo[]>;
  /** Set when the ID is also used elsewhere and the user hasn't decided yet. */
  problem?: SectionInfo["problem"];
  /** Gives this occurrence a new number. */
  onRenumber?: () => void;
}

const problemText = { duplicate: "Also used by a copy in", collision: "Also used by another section in" };

/**
 * The badge that stands for a section anchor in the preview: the favicon, focusable, with the
 * section ID, the document path and the section's UID in a tooltip. Clicking it copies the
 * section ID. A badge whose ID is also used elsewhere is marked, and its tooltip names the other
 * occurrences and offers to renumber this one.
 */
export function SectionBadge({ sectionId, uid: anchorUid, path, loadSections, problem, onRenumber }: SectionBadgeProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadedUid, setUid] = useState<string | null | undefined>(undefined);
  const uid = anchorUid ?? loadedUid;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setCopied(false);
    if (next && uid === undefined && loadSections !== undefined) {
      loadSections(path)
        .then((sections) => setUid(sections.find((s) => s.id === sectionId)?.uid ?? null))
        .catch(() => setUid(null));
    }
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
            className={cn("section-badge", problem !== undefined && "section-badge-problem")}
            aria-label={`Section ${sectionId}${problem === undefined ? "" : " (ID used more than once)"}: copy its ID`}
            data-section-id={sectionId}
            onClick={() => void copy()}
          >
            <img src={badgeUri} alt="" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          {copied ? (
            <p role="status">Copied {sectionId}</p>
          ) : (
            <>
              <p className="font-semibold">{sectionId}</p>
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
    </TooltipProvider>
  );
}
