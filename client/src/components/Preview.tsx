import type { Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import type { SectionInfo } from "@specquer/shared/api";
import { CLOBBER_PREFIX } from "@specquer/shared/markdown";
import { isMarkdownFile, normalizePath, parentPath } from "@specquer/shared/paths";
import { SectionBadge } from "@/components/SectionBadge";
import { type PreviewRenderer, createPreviewRenderer } from "@/preview/renderer";
import { cn } from "@/lib/utils";

/** Split view renders wait this long after the last keystroke. */
export const PREVIEW_DEBOUNCE = 250;

let sharedRenderer: PreviewRenderer | null = null;
function renderer(): PreviewRenderer {
  return (sharedRenderer ??= createPreviewRenderer());
}

/** Resolves a relative link to another Markdown file, or returns `undefined`. */
export function resolveDocumentLink(href: string, currentFile: string): { path: string; hash: string } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("#")) return undefined;
  const [pathPart = "", hash = ""] = href.split("#", 2);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return undefined;
  }
  const folder = parentPath(currentFile);
  const segments: string[] = folder === "" ? [] : folder.split("/");
  for (const segment of decoded.split("/")) {
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else if (segment !== "." && segment !== "") segments.push(segment);
  }
  try {
    const path = normalizePath(segments.join("/"));
    return isMarkdownFile(path) ? { path, hash } : undefined;
  } catch {
    return undefined;
  }
}

/** A request to scroll the preview to a section; `request` changes for each new request. */
export interface ScrollTarget {
  sectionId: string;
  request: number;
}

export interface PreviewProps {
  markdown: string;
  currentFile: string;
  /** Opens another document; `hash` is the link's fragment (a section ID), if any. */
  onOpenFile: (path: string, hash?: string) => void;
  /** Loads a document's sections, for the badges' tooltips. */
  loadSections?: (path: string) => Promise<SectionInfo[]>;
  scrollTarget?: ScrollTarget;
  /** Delay before rendering changes; 0 renders at once. */
  debounce?: number;
  className?: string;
}

export function Preview({ markdown, currentFile, onOpenFile, loadSections, scrollTarget, debounce = 0, className }: PreviewProps) {
  const [tree, setTree] = useState<Root | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const scrolled = useRef<number | null>(null);

  useEffect(() => {
    const request = ++latest.current;
    const run = () =>
      renderer()
        .render(markdown)
        .then((result) => {
          // Drop results for text that has since changed
          if (request !== latest.current) return;
          setTree(result);
          setError(null);
        })
        .catch((err: Error) => request === latest.current && setError(err.message));
    if (debounce === 0 || tree === null) {
      void run();
      return;
    }
    const timer = setTimeout(run, debounce);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, debounce]);

  const content = useMemo(() => {
    if (tree === null) return null;
    const Link = ({ href, children, ...props }: ComponentProps<"a"> & { node?: unknown; "data-section-anchor"?: string }) => {
      delete props.node;
      if (props["data-section-anchor"] !== undefined && typeof props.id === "string") {
        // The anchor stays (invisible) as the scroll target; the badge stands for it
        return (
          <>
            <a {...props} />
            <SectionBadge sectionId={props.id.slice(CLOBBER_PREFIX.length)} path={currentFile} loadSections={loadSections} />
          </>
        );
      }
      if (href === undefined) return <a {...props}>{children}</a>;
      if (href.startsWith("#")) return <a href={href} {...props}>{children}</a>;
      const target = resolveDocumentLink(href, currentFile);
      if (target !== undefined) {
        return (
          <a
            href={href}
            {...props}
            onClick={(event) => {
              event.preventDefault();
              onOpenFile(target.path, target.hash === "" ? undefined : decodeURIComponent(target.hash));
            }}
          >
            {children}
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    };
    return toJsxRuntime(tree, { Fragment, jsx, jsxs, components: { a: Link } }) as ReactNode;
  }, [tree, currentFile, onOpenFile, loadSections]);

  // Scroll to a requested section once it has been rendered
  useEffect(() => {
    if (scrollTarget === undefined || scrolled.current === scrollTarget.request || content === null) return;
    const target = container.current?.querySelector(`[id="${CLOBBER_PREFIX}${scrollTarget.sectionId}"]`);
    if (target === null || target === undefined) return;
    scrolled.current = scrollTarget.request;
    target.scrollIntoView({ block: "start" });
  }, [content, scrollTarget]);

  return (
    <div ref={container} className={cn("h-full overflow-auto", className)} data-testid="preview">
      {error !== null && <p className="text-error-text p-4">Preview failed: {error}</p>}
      <article className="markdown px-6 py-4">{content}</article>
    </div>
  );
}
