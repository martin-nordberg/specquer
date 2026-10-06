import { Editor, defaultValueCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The WYSIWYG view (Milkdown). Milkdown rewrites Markdown it serializes (list markers, tables,
 * reference links), so its output is reported only after the user changes something; opening a
 * file here never changes it (decision D5).
 */
export interface MilkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  className?: string;
}

export function MilkdownEditor({ value, onChange, className }: MilkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let editor: Editor | null = null;
    let disposed = false;
    void Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host.current!);
        ctx.set(defaultValueCtx, value);
        ctx.update(editorViewOptionsCtx, (options) => ({
          ...options,
          attributes: { class: "markdown", "aria-label": "Markdown content (WYSIWYG)", spellcheck: "true" },
        }));
        // Closer to the style most specs use
        ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const, rule: "-" as const }));
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, previous) => {
          if (markdown !== previous) onChangeRef.current(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .create()
      .then((created) => {
        if (disposed) void created.destroy();
        else editor = created;
      });
    return () => {
      disposed = true;
      void editor?.destroy();
    };
    // The editor is created once per document revision (the parent remounts it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className={cn("milkdown h-full overflow-auto", className)} data-testid="wysiwyg" />;
}
