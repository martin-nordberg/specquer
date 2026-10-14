import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { keymap } from "@milkdown/kit/prose/keymap";
import type { Mark, Node } from "@milkdown/kit/prose/model";
import { Plugin, Selection, type Transaction } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { useEffect, useRef } from "react";
import { linkText } from "@specquer/shared/markdown";
import { cn } from "@/lib/utils";

/**
 * Turns links into their text and URL, and images into their alt text and URL, after every
 * change, whatever brought them (typing, paste, or a comment written by hand): comments never hold
 * links or images (R2.10, decision D5). Milkdown's parser needs the link and image schemas to read
 * Markdown that holds them, so they stay in the schema.
 */
export function plainLinksPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      return plainLinks(state.doc, state.tr);
    },
  });
}

/** The changes that turn a document's links and images into text, or `null` when it has none. */
export function plainLinks(doc: Node, tr: Transaction): Transaction | null {
  const schema = doc.type.schema;
  const linkType = schema.marks.link;
  const imageType = schema.nodes.image;
  const edits: Array<{ from: number; to: number; kind: "link"; mark: Mark } | { from: number; to: number; kind: "image"; text: string }> = [];
  doc.descendants((node, pos) => {
    if (imageType !== undefined && node.type === imageType) {
      edits.push({ from: pos, to: pos + node.nodeSize, kind: "image", text: linkText(String(node.attrs.alt ?? ""), String(node.attrs.src ?? "")) });
      return false;
    }
    const mark = linkType === undefined ? undefined : node.marks.find((m) => m.type === linkType);
    if (node.isText && mark !== undefined) {
      // Adjacent text with the same link (a bold word inside it) is one link
      const last = edits.at(-1);
      if (last?.kind === "link" && last.to === pos && last.mark.eq(mark)) last.to = pos + node.nodeSize;
      else edits.push({ from: pos, to: pos + node.nodeSize, kind: "link", mark });
    }
    return true;
  });
  if (edits.length === 0) return null;
  for (const edit of edits.reverse()) {
    if (edit.kind === "image") {
      if (edit.text === "") tr.delete(edit.from, edit.to);
      else tr.replaceWith(edit.from, edit.to, schema.text(edit.text));
      continue;
    }
    const href = String(edit.mark.attrs.href ?? "");
    const text = doc.textBetween(edit.from, edit.to);
    tr.removeMark(edit.from, edit.to, edit.mark);
    const shown = linkText(text, href);
    if (shown !== text) tr.insert(edit.to, schema.text(shown.slice(text.length)));
  }
  return tr;
}

export interface CommentEditorProps {
  /** The text to start from: the comment being edited, or "" for a new one. */
  initial: string;
  /** The editor's accessible name. */
  label: string;
  /**
   * Called when the editor loses focus, with its text: `close` when the focus moved elsewhere in
   * the page, not when the window lost it (the editor then stays open).
   */
  onSave: (text: string, close: boolean) => void;
  /** Escape: closes the editor without saving. */
  onCancel: () => void;
  /** Gives the store a way to read the text (for a save when the page closes); `null` on unmount. */
  registerDraft?: (draft: (() => string) | null) => void;
  className?: string;
}

/**
 * A comment's WYSIWYG editor (R2.5): Milkdown with CommonMark, GFM and undo, no section anchors,
 * links or images. It takes the focus when it opens. An unchanged document reports `initial`
 * exactly, so opening a comment and leaving it never rewrites it in Milkdown's style.
 */
export function CommentEditor({ initial, label, onSave, onCancel, registerDraft, className }: CommentEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onSave, onCancel });
  handlers.current = { onSave, onCancel };
  const text = useRef<() => string>(() => initial);
  const cancelled = useRef(false);

  useEffect(() => {
    let editor: Editor | null = null;
    let disposed = false;
    let start: Node | null = null;
    text.current = () => {
      if (editor === null) return initial;
      return editor.action((ctx) => {
        const doc = ctx.get(editorViewCtx).state.doc;
        if (start !== null && doc.eq(start)) return initial;
        // Milkdown ends its Markdown with a line break, which a comment doesn't need, and escapes
        // a URL's colon so it doesn't become a link; comments never show links anyway (R2.10)
        return ctx.get(serializerCtx)(doc).trimEnd().replace(/\b([a-z][a-z0-9+.-]*)\\:\/\//gi, "$1://");
      });
    };
    const escape = keymap({
      Escape: () => {
        cancelled.current = true;
        handlers.current.onCancel();
        return true;
      },
    });
    void Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host.current!);
        ctx.set(defaultValueCtx, initial);
        ctx.update(editorViewOptionsCtx, (options) => ({
          ...options,
          attributes: { class: "markdown min-h-16 px-2 py-1 outline-none", "aria-label": label, "aria-multiline": "true", role: "textbox", spellcheck: "true" },
        }));
        ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const, rule: "-" as const }));
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use($prose(() => escape))
      .use($prose(() => plainLinksPlugin()))
      .create()
      .then((created) => {
        if (disposed) {
          void created.destroy();
          return;
        }
        editor = created;
        created.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          start = view.state.doc;
          // The focus, with the cursor at the end
          view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
          view.focus();
        });
      });
    registerDraft?.(() => text.current());
    return () => {
      disposed = true;
      registerDraft?.(null);
      void editor?.destroy();
    };
    // The editor is created once; the parent remounts it for another comment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={host}
      className={cn("milkdown rounded-md border bg-background text-sm focus-within:ring-2 focus-within:ring-ring/50", className)}
      data-testid="comment-editor"
      onBlur={(event) => {
        if (cancelled.current) return;
        // Focus moving within the editor isn't leaving it
        if (event.relatedTarget instanceof globalThis.Node && event.currentTarget.contains(event.relatedTarget)) return;
        handlers.current.onSave(text.current(), document.hasFocus());
      }}
    />
  );
}
