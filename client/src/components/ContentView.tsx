import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Columns2, Eye, FileCode, PenLine } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SectionInfo, SectionStatusLists } from "@specquer/shared/api";
import { type SummarizedSection, type TopPosition, sectionAtPath } from "@specquer/shared/markdown";
import { bodySections, headingPathAt } from "@/app/body-sections";
import { sectionExtents } from "@specquer/shared/sections";
import type { ViewType } from "@specquer/shared/uistate";
import { cn } from "@/lib/utils";
import { CodeEditor, lineWrapping } from "./CodeEditor";
import { commentGutter, setCommentGutterMarkers } from "./comments/comment-gutter";
import type { CommentMarkers } from "./comments/markers";
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
  /** Increases when the body gets a change from outside the editors that is undoable like typing. */
  undoableEdits?: number;
  /** The status lists for the open file, for the badges and the section attributes dialog. */
  statusLists?: SectionStatusLists;
  /** Sets a section's status in the open file (`null`: inherited); returns an error message, or `null`. */
  onSetStatus?: (id: string, uid: string | null, status: string | null) => string | null;
  /** Called when a badge's menu opens, to load the status lists again. */
  onStatusMenu?: () => void;
  scrollTarget?: ScrollTarget;
  /** Summaries in the preview (split and preview views). */
  summaries?: PreviewSummaries;
  /** Registers the WYSIWYG view's flush of pending edits with the document store. */
  registerFlush?: (flush: () => void) => () => void;
  /** Comment threads: pips, highlighting and the badge menu's comment items (Step 012). */
  comments?: CommentMarkers;
  /**
   * The view reports where its top is as it scrolls, for the Comments and Outline panes to follow
   * (Step 012, R7.7; Step 016, R6): the section there, and the heading's outline path.
   */
  onTopPosition?: (position: TopPosition) => void;
  /** The preview reports the sections it shows summarized (Step 016, R7). */
  onSummarized?: (summarized: readonly SummarizedSection[]) => void;
}

/** The innermost section holding an offset of a text, by its UID (for the Comments pane to follow). */
function sectionAt(doc: Text, offset: number, cache: { doc: Text | null; sections: Array<{ uid: string | null; from: number; to: number }> }): string | null {
  if (cache.doc !== doc) {
    const text = doc.toString();
    const found = bodySections(text).sections;
    const extents = sectionExtents(found.map((section) => ({ ...section, start: section.anchor?.from ?? section.insertAt })), text.length);
    cache.doc = doc;
    cache.sections = found.map((section, index) => ({ uid: section.uid, ...extents[index]! }));
  }
  let uid: string | null = null;
  for (const section of cache.sections) if (section.uid !== null && section.from <= offset && offset < section.to) uid = section.uid;
  return uid;
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
  undoableEdits,
  statusLists,
  onSetStatus,
  onStatusMenu,
  scrollTarget,
  summaries,
  registerFlush,
  comments,
  onTopPosition,
  onSummarized,
}: ContentViewProps) {
  const [textView, setTextView] = useState<EditorView | null>(null);
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
      commentGutter(),
    ],
    [],
  );

  // The text view's pips and highlights
  useEffect(() => {
    if (textView !== null) setCommentGutterMarkers(textView, comments ?? null);
  }, [textView, comments]);

  // Where the text view's top is, as it scrolls (Step 012, R7.7; Step 016, R6)
  useEffect(() => {
    if (textView === null || onTopPosition === undefined) return;
    const cache = { doc: null as Text | null, sections: [] as Array<{ uid: string | null; from: number; to: number }> };
    let frame = 0;
    const report = () => {
      frame = 0;
      const block = textView.lineBlockAtHeight(textView.scrollDOM.scrollTop);
      onTopPosition({ uid: sectionAt(textView.state.doc, block.from, cache), outlinePath: headingPathAt(textView.state.doc.toString(), block.from) });
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(report);
    };
    textView.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      textView.scrollDOM.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [textView, onTopPosition]);

  // Scrolls the text view to a requested section's anchor
  const scrolled = useRef<number | null>(null);
  useEffect(() => {
    if (textView === null || scrollTarget === undefined || scrolled.current === scrollTarget.request) return;
    const text = textView.state.doc.toString();
    let from: number | undefined;
    if ("sectionId" in scrollTarget) {
      const { sectionId, uid } = scrollTarget;
      from = bodySections(text).sections.find((found) => found.id === sectionId && (uid === undefined || found.uid === uid))?.anchor?.from;
    } else {
      // A heading by its outline path (Step 016, R5.1)
      from = sectionAtPath(bodySections(text).outline, scrollTarget.outlinePath)?.heading.from;
    }
    if (from === undefined) return;
    scrolled.current = scrollTarget.request;
    textView.dispatch({ effects: EditorView.scrollIntoView(from, { y: "start", yMargin: 8 }) });
  }, [textView, scrollTarget]);
  const editor = (
    <CodeEditor
      value={body}
      onChange={onChange}
      language="markdown"
      ariaLabel="Markdown content"
      extensions={extensions}
      {...(undoableEdits === undefined ? {} : { undoableEdits })}
      onView={setTextView}
    />
  );
  const preview = (debounce: number) => (
    <Preview
      markdown={body}
      currentFile={path}
      onOpenFile={onOpenFile}
      loadSections={loadSections}
      savedVersion={savedVersion}
      onRenumber={onRenumber}
      statusLists={statusLists}
      onSetStatus={onSetStatus}
      onStatusMenu={onStatusMenu}
      scrollTarget={scrollTarget}
      comments={comments}
      summaries={summaries}
      debounce={debounce}
      {...(onTopPosition === undefined ? {} : { onTopPosition })}
      {...(onSummarized === undefined ? {} : { onSummarized })}
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
      return (
        <MilkdownEditor
          key={externalEdits}
          value={body}
          onChange={onChange}
          statusLists={statusLists}
          onStatusMenu={onStatusMenu}
          registerFlush={registerFlush}
          comments={comments}
          scrollTarget={scrollTarget}
          {...(onTopPosition === undefined ? {} : { onTopPosition })}
        />
      );
  }
}
