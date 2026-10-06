import type { Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { isMarkdownFile, normalizePath, parentPath } from "@specquer/shared/paths";
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

export interface PreviewProps {
  markdown: string;
  currentFile: string;
  onOpenFile: (path: string) => void;
  /** Delay before rendering changes; 0 renders at once. */
  debounce?: number;
  className?: string;
}

export function Preview({ markdown, currentFile, onOpenFile, debounce = 0, className }: PreviewProps) {
  const [tree, setTree] = useState<Root | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

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
    const Link = ({ href, children, ...props }: ComponentProps<"a"> & { node?: unknown }) => {
      delete props.node;
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
              onOpenFile(target.path);
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
  }, [tree, currentFile, onOpenFile]);

  return (
    <div className={cn("h-full overflow-auto", className)} data-testid="preview">
      {error !== null && <p className="text-error-text p-4">Preview failed: {error}</p>}
      <article className="markdown px-6 py-4">{content}</article>
    </div>
  );
}
