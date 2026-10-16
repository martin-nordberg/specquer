import { ChevronDown, ChevronRight, Heading } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { OutlineItem } from "@specquer/shared/markdown";
import { badgeUri } from "@/components/SectionBadge";
import { cn } from "@/lib/utils";

/** How a row's section looks: its badge's warning ring, for an ID used twice or a status that isn't allowed. */
export type ItemMarks = (item: OutlineItem) => { problem: boolean; label?: string };

export interface OutlineTreeProps {
  items: readonly OutlineItem[];
  /** The keys of the items whose sections are summarized (Step 016, R7.2). */
  summarized: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  /** The highlighted item's key, and whether it stands for an item inside it (R4.5, R7.6). */
  highlight: { key: string; inside: boolean } | null;
  marks: ItemMarks;
  onToggle: (item: OutlineItem, collapsed: boolean) => void;
  onMove: (item: OutlineItem) => void;
  /** Called with the highlighted row's element, to scroll it into view. */
  onHighlightRow?: (row: HTMLElement) => void;
}

interface Row {
  item: OutlineItem;
  level: number;
  parent: string | null;
  expandable: boolean;
}

/** The rows shown, in order: what isn't inside a collapsed item. */
function visibleRows(items: readonly OutlineItem[], collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const visit = (list: readonly OutlineItem[], level: number, parent: string | null) => {
    for (const item of list) {
      const expandable = item.children.length > 0;
      rows.push({ item, level, parent, expandable });
      if (expandable && !collapsed.has(item.key)) visit(item.children, level + 1, item.key);
    }
  };
  visit(items, 1, null);
  return rows;
}

/**
 * The Outline's tree (Step 016, R2 to R5, R12): one row per item, on one line. The icon and the
 * space left of it expand and collapse; the text and the space right of it move the file pane.
 * One row is in the tab order; the arrow keys, Home and End move, Enter and Space move the file
 * pane to the section.
 */
export function OutlineTree({ items, summarized, collapsed, highlight, marks, onToggle, onMove, onHighlightRow }: OutlineTreeProps) {
  const rows = useMemo(() => visibleRows(items, collapsed), [items, collapsed]);
  const rowOf = useMemo(() => new Map(rows.map((row) => [row.item, row])), [rows]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const tree = useRef<HTMLUListElement>(null);
  const focused = rows.find((row) => row.item.key === focusKey) ?? rows.find((row) => row.item.key === highlight?.key) ?? rows[0];

  useEffect(() => {
    if (highlight === null) return;
    const row = tree.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(highlight.key)}"]`);
    if (row) onHighlightRow?.(row);
  }, [highlight, onHighlightRow]);

  const focusRow = (key: string) => {
    setFocusKey(key);
    tree.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, row: Row) => {
    const index = rows.indexOf(row);
    const open = row.expandable && !collapsed.has(row.item.key);
    const go = (to: Row | undefined) => {
      if (to === undefined) return;
      event.preventDefault();
      focusRow(to.item.key);
    };
    switch (event.key) {
      case "ArrowDown":
        return go(rows[index + 1]);
      case "ArrowUp":
        return go(rows[index - 1]);
      case "Home":
        return go(rows[0]);
      case "End":
        return go(rows.at(-1));
      case "ArrowRight":
        event.preventDefault();
        if (row.expandable && !open) onToggle(row.item, false);
        else if (open) focusRow(rows[index + 1]!.item.key);
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (open) onToggle(row.item, true);
        else if (row.parent !== null) focusRow(row.parent);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        onMove(row.item);
        return;
    }
  };

  const render = (list: readonly OutlineItem[], level: number) =>
    list.map((item) => {
      const row = rowOf.get(item);
      if (row === undefined) return null;
      const open = row.expandable && !collapsed.has(item.key);
      const isHighlight = highlight?.key === item.key;
      const { problem, label } = marks(item);
      const Chevron = open ? ChevronDown : ChevronRight;
      return (
        <li
          key={item.key}
          role="treeitem"
          aria-level={level}
          aria-expanded={row.expandable ? open : undefined}
          aria-selected={isHighlight}
          aria-label={item.text}
          data-key={item.key}
          tabIndex={row === focused ? 0 : -1}
          className="outline-none focus-visible:[&>div]:ring-2 focus-visible:[&>div]:ring-ring/50 focus-visible:[&>div]:ring-inset"
          onKeyDown={(event) => {
            if (event.target === event.currentTarget) onKeyDown(event, row);
          }}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocusKey(item.key);
          }}
        >
          <div
            className={cn(
              "flex items-center text-sm",
              isHighlight && !highlight.inside && "bg-navigation text-navigation-foreground",
              isHighlight && highlight.inside && "bg-navigation/20",
            )}
            title={item.text}
          >
            {/* The indentation, the expander and the icon expand and collapse */}
            <span
              className="flex shrink-0 cursor-default items-center gap-0.5 py-1"
              style={{ paddingLeft: `${0.25 + (level - 1) * 0.9}rem` }}
              onClick={() => row.expandable && onToggle(item, open)}
              data-part="toggle"
            >
              {row.expandable ? <Chevron className="size-3.5 opacity-70" aria-hidden /> : <span className="w-3.5" />}
              {item.sectionId !== null ? (
                <img src={badgeUri} alt="" className={cn("size-4 rounded-[0.2em]", problem && "ring-2 ring-warning")} {...(label === undefined ? {} : { title: label })} />
              ) : item.kind === "heading" ? (
                <Heading className="size-4 opacity-70" aria-hidden />
              ) : (
                <span className="size-4" />
              )}
            </span>
            {/* The text and the space right of it move the file pane */}
            <span className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 pr-2 pl-1.5" onClick={() => onMove(item)} data-part="text">
              <span className="truncate">{item.text}</span>
              {summarized.has(item.key) && <span className={cn("shrink-0 text-xs", isHighlight && !highlight.inside ? "opacity-80" : "text-muted-foreground")}>summary</span>}
            </span>
          </div>
          {open && (
            <ul role="group" className="m-0 list-none p-0">
              {render(item.children, level + 1)}
            </ul>
          )}
        </li>
      );
    });

  return (
    <ul ref={tree} role="tree" aria-label="Outline" className="m-0 list-none p-0 select-none">
      {render(items, 1)}
    </ul>
  );
}
