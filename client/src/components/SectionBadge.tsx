import { useState } from "react";
import type { SectionInfo } from "@specquer/shared/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { faviconSvg, svgDataUri } from "@/theme/logo";

const badgeUri = svgDataUri(faviconSvg);

export interface SectionBadgeProps {
  sectionId: string;
  /** The document's workspace path. */
  path: string;
  /** Loads the document's sections, for the tooltip's CUID2. */
  loadSections?: (path: string) => Promise<SectionInfo[]>;
}

/**
 * The badge that stands for a section anchor in the preview: the favicon, focusable, with the
 * section ID, the document path and the section's CUID2 in a tooltip. Clicking it copies the
 * section ID.
 */
export function SectionBadge({ sectionId, path, loadSections }: SectionBadgeProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uid, setUid] = useState<string | null | undefined>(undefined);

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
            className="section-badge"
            aria-label={`Section ${sectionId}: copy its ID`}
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
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
