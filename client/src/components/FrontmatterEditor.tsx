import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { checkYaml, type YamlProblem } from "@specquer/shared/markdown";
import { CodeEditor } from "./CodeEditor";

/** Pixel height of one editor line plus the editor's padding. */
const LINE_HEIGHT = 21;
const PADDING = 14;
export const MIN_FRONTMATTER_HEIGHT = LINE_HEIGHT + PADDING;

/** Initial height: one line for a file without front matter, three lines otherwise. */
export function initialFrontmatterHeight(hasFrontmatter: boolean): number {
  return (hasFrontmatter ? 3 : 1) * LINE_HEIGHT + PADDING;
}

export interface FrontmatterEditorProps {
  value: string;
  onChange: (value: string) => void;
  height: number;
  /** Called when the drag bar is released. */
  onHeightChange: (height: number) => void;
}

/**
 * The front matter, without its `---` delimiters, in its own YAML editor. There is no schema;
 * invalid YAML is saved as typed and only marked with a warning.
 */
export function FrontmatterEditor({ value, onChange, height, onHeightChange }: FrontmatterEditorProps) {
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [problems, setProblems] = useState<YamlProblem[]>([]);
  const start = useRef({ y: 0, height: 0 });
  const shown = dragHeight ?? height;

  useEffect(() => {
    const timer = setTimeout(() => setProblems(value === "" ? [] : checkYaml(value)), 300);
    return () => clearTimeout(timer);
  }, [value]);

  const heightAt = (clientY: number) => Math.max(MIN_FRONTMATTER_HEIGHT, start.current.height + clientY - start.current.y);

  return (
    <section aria-label="Front matter" className="shrink-0 border-b">
      <div className="relative" style={{ height: shown }}>
        <CodeEditor
          value={value}
          onChange={onChange}
          language="yaml"
          ariaLabel="Front matter (YAML)"
          placeholder="Front matter (YAML)"
          className="bg-muted/40"
        />
        {problems.length > 0 && (
          <div
            role="status"
            title={problems.map((p) => (p.line ? `Line ${p.line}: ${p.message}` : p.message)).join("\n")}
            className="absolute top-1 right-2 flex items-center gap-1 rounded-sm bg-warning px-1.5 py-0.5 text-xs text-warning-foreground"
          >
            <AlertTriangle className="size-3.5" />
            Invalid YAML
          </div>
        )}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the front matter editor"
        tabIndex={0}
        className="h-1.5 cursor-row-resize bg-border transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = { y: event.clientY, height: shown };
          setDragHeight(shown);
        }}
        onPointerMove={(event) => {
          if (dragHeight !== null) setDragHeight(heightAt(event.clientY));
        }}
        onPointerUp={(event) => {
          if (dragHeight === null) return;
          onHeightChange(heightAt(event.clientY));
          setDragHeight(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") onHeightChange(Math.max(MIN_FRONTMATTER_HEIGHT, height - LINE_HEIGHT));
          if (event.key === "ArrowDown") onHeightChange(height + LINE_HEIGHT);
        }}
      />
    </section>
  );
}
