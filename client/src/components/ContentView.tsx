import { Columns2, Eye, FileCode, PenLine } from "lucide-react";
import type { ViewType } from "@specquer/shared/uistate";
import { cn } from "@/lib/utils";
import { CodeEditor, lineWrapping } from "./CodeEditor";
import { MilkdownEditor } from "./MilkdownEditor";
import { PREVIEW_DEBOUNCE, Preview } from "./Preview";

const views: Array<{ type: ViewType; label: string; icon: typeof Eye }> = [
  { type: "text", label: "Text", icon: FileCode },
  { type: "split", label: "Split", icon: Columns2 },
  { type: "preview", label: "Preview", icon: Eye },
  { type: "wysiwyg", label: "WYSIWYG", icon: PenLine },
];

export function ViewSwitcher({ value, onChange }: { value: ViewType; onChange: (view: ViewType) => void }) {
  return (
    <div role="radiogroup" aria-label="View" className="flex shrink-0 rounded-md border p-0.5">
      {views.map(({ type, label, icon: Icon }) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={value === type}
          className={cn(
            "flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            value === type ? "bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
          onClick={() => onChange(type)}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

export interface ContentViewProps {
  viewType: ViewType;
  body: string;
  path: string;
  onChange: (body: string) => void;
  onOpenFile: (path: string) => void;
}

/** The Markdown body in the chosen view. All views edit the same in-memory text. */
export function ContentView({ viewType, body, path, onChange, onOpenFile }: ContentViewProps) {
  const editor = (
    <CodeEditor value={body} onChange={onChange} language="markdown" ariaLabel="Markdown content" extensions={[lineWrapping]} />
  );
  switch (viewType) {
    case "text":
      return editor;
    case "split":
      return (
        <div className="grid h-full min-h-0 grid-cols-2">
          <div className="min-h-0 min-w-0 border-r">{editor}</div>
          <Preview markdown={body} currentFile={path} onOpenFile={onOpenFile} debounce={PREVIEW_DEBOUNCE} />
        </div>
      );
    case "preview":
      return <Preview markdown={body} currentFile={path} onOpenFile={onOpenFile} />;
    case "wysiwyg":
      return <MilkdownEditor value={body} onChange={onChange} />;
  }
}
