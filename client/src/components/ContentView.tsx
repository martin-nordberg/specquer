import { Columns2, Eye, FileCode, PenLine } from "lucide-react";
import { useMemo, useRef } from "react";
import type { SectionInfo } from "@specquer/shared/api";
import type { ViewType } from "@specquer/shared/uistate";
import { cn } from "@/lib/utils";
import { CodeEditor, lineWrapping } from "./CodeEditor";
import { MilkdownEditor } from "./MilkdownEditor";
import { PREVIEW_DEBOUNCE, Preview, type PreviewSummaries, type ScrollTarget } from "./Preview";
import { type SectionSearch, sectionCompletion } from "./section-completion";
import { sectionEditing } from "./section-editing";

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
  /** Increases when anchors added on save change the body; the WYSIWYG view then reloads. */
  externalEdits: number;
  onChange: (body: string) => void;
  onOpenFile: (path: string, hash?: string) => void;
  loadSections?: (path: string) => Promise<SectionInfo[]>;
  searchSections?: SectionSearch;
  /** The file's version on disk; the preview reloads the badges' problems when it changes. */
  savedVersion?: string;
  /** Renumbers one occurrence of a duplicate ID in the open file. */
  onRenumber?: (id: string, uid: string | null) => void;
  scrollTarget?: ScrollTarget;
  /** Summaries in the preview (split and preview views). */
  summaries?: PreviewSummaries;
}

/** The Markdown body in the chosen view. All views edit the same in-memory text. */
export function ContentView({
  viewType,
  body,
  path,
  externalEdits,
  onChange,
  onOpenFile,
  loadSections,
  searchSections,
  savedVersion,
  onRenumber,
  scrollTarget,
  summaries,
}: ContentViewProps) {
  const pathRef = useRef(path);
  pathRef.current = path;
  const searchRef = useRef(searchSections);
  searchRef.current = searchSections;
  // Created once: the editor reads its extensions only when it is created
  const extensions = useMemo(
    () => [
      lineWrapping,
      sectionCompletion(
        (query, target) => searchRef.current?.(query, target) ?? Promise.resolve([]),
        () => pathRef.current,
      ),
      // A pasted anchor is a copy if another document holds its ID
      sectionEditing(async (id) => {
        const results = (await searchRef.current?.(id)) ?? [];
        return results.some((result) => result.id === id && result.path !== pathRef.current);
      }),
    ],
    [],
  );
  const editor = <CodeEditor value={body} onChange={onChange} language="markdown" ariaLabel="Markdown content" extensions={extensions} />;
  const preview = (debounce: number) => (
    <Preview
      markdown={body}
      currentFile={path}
      onOpenFile={onOpenFile}
      loadSections={loadSections}
      savedVersion={savedVersion}
      onRenumber={onRenumber}
      scrollTarget={scrollTarget}
      summaries={summaries}
      debounce={debounce}
    />
  );
  switch (viewType) {
    case "text":
      return editor;
    case "split":
      return (
        <div className="grid h-full min-h-0 grid-cols-2">
          <div className="min-h-0 min-w-0 border-r">{editor}</div>
          {preview(PREVIEW_DEBOUNCE)}
        </div>
      );
    case "preview":
      return preview(0);
    case "wysiwyg":
      return <MilkdownEditor key={externalEdits} value={body} onChange={onChange} />;
  }
}
