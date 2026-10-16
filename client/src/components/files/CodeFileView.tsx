import type { Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { type ReactNode, useEffect, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { languageForFile } from "@specquer/shared/markdown";
import { sharedPreviewRenderer } from "@/preview/renderer";

/**
 * A text file, view-only, as the preview would show it in one fenced code block, highlighted
 * in its language with a gutter of line numbers (Step 014, R3).
 */
export function CodeFileView({ path, text }: { path: string; text: string }) {
  const [tree, setTree] = useState<{ path: string; text: string; root: Root } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    sharedPreviewRenderer()
      .renderCode(text, languageForFile(path))
      .then((root) => {
        if (current) setTree({ path, text, root });
      })
      .catch((err: Error) => {
        if (current) setError(err.message);
      });
    return () => {
      current = false;
    };
  }, [path, text]);
  let content: ReactNode = null;
  if (error !== null) content = <p className="text-sm text-error-text">The file couldn't be shown: {error}</p>;
  else if (tree !== null && tree.path === path && tree.text === text) content = toJsxRuntime(tree.root, { Fragment, jsx, jsxs }) as ReactNode;
  return (
    <div className="h-full overflow-auto" data-testid="code-view">
      <article className="markdown min-h-full p-4">{content}</article>
    </div>
  );
}
