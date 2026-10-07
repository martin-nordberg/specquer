import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExtension } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { changesBetween } from "@/app/edits";
import { cn } from "@/lib/utils";

/**
 * A small wrapper around CodeMirror 6 (decision D4). The editor owns its document while mounted:
 * `value` sets the initial content and later changes it only when it differs from what the
 * editor last reported, so typing never round-trips through React. Such outside changes (anchors
 * added on save) are applied as the minimal edits, so the selection is mapped and the cursor
 * stays put, and they stay out of the undo history: undo never removes an assigned anchor.
 */

// Colors come from the palette's CSS custom properties, so light and dark mode need no rebuild
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--background)", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--foreground)", padding: "6px 0" },
  ".cm-line": { padding: "0 12px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--primary) 30%, transparent) !important",
  },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
});

const highlighting = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold", color: "var(--navigation)" },
  { tag: tags.heading1, fontSize: "1.25em" },
  { tag: tags.heading2, fontSize: "1.15em" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--primary)", textDecoration: "underline" },
  { tag: [tags.monospace, tags.string], color: "var(--muted-foreground)" },
  { tag: [tags.processingInstruction, tags.meta, tags.comment, tags.contentSeparator], color: "var(--muted-foreground)" },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--primary)", fontWeight: "600" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--error-text)" },
  { tag: tags.invalid, color: "var(--error-text)" },
]);

const darkHighlighting = HighlightStyle.define(
  [
    { tag: tags.heading, fontWeight: "bold", color: "var(--secondary)" },
    { tag: [tags.link, tags.url], color: "var(--secondary)", textDecoration: "underline" },
    { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--secondary)", fontWeight: "600" },
  ],
  { themeType: "dark" },
);

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: "markdown" | "yaml";
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  /** Extra extensions, such as line wrapping. */
  extensions?: Extension[];
}

export function CodeEditor({ value, onChange, language, ariaLabel, placeholder, className, extensions = [] }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const reported = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        language === "markdown" ? markdown() : yaml(),
        syntaxHighlighting(darkHighlighting),
        syntaxHighlighting(highlighting),
        theme,
        EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
        placeholder ? placeholderExtension(placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          reported.current = text;
          onChangeRef.current(text);
        }),
        ...extensions,
      ],
    });
    view.current = new EditorView({ state, parent: host.current! });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
    // The editor is created once; `value` changes are applied below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const current = view.current;
    if (current === null || value === reported.current) return;
    reported.current = value;
    current.dispatch({
      changes: changesBetween(current.state.doc.toString(), value),
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  return <div ref={host} className={cn("h-full overflow-hidden", className)} data-language={language} />;
}

export const lineWrapping = EditorView.lineWrapping;
