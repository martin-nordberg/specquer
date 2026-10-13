import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import {
  MAX_CHAT_PANE_FRACTION,
  MAX_TREE_PANE_FRACTION,
  MIN_CHAT_PANE_FRACTION,
  MIN_FILE_PANE_FRACTION,
  MIN_TREE_PANE_FRACTION,
  paneWidths,
} from "@specquer/shared/uistate";

/**
 * The window's panes (Step 010, R1): folders | file | chat, the chat pane optional, each width a
 * fraction of the window, with a drag bar between neighbors. The file pane keeps at least 30%:
 * a drag stops there, and when both side panes are wide the chat pane gives way first
 * (`paneWidths`).
 */
export interface PaneLayoutProps {
  treeFraction: number;
  chatFraction: number;
  chatOpen: boolean;
  /** Called when a drag or key press ends, with the new fraction. */
  onTreeFractionChange: (fraction: number) => void;
  onChatFractionChange: (fraction: number) => void;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const STEP = 0.02;

export function PaneLayout({ treeFraction, chatFraction, chatOpen, onTreeFractionChange, onChatFractionChange, left, center, right }: PaneLayoutProps) {
  const container = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ tree?: number; chat?: number }>({});
  const widths = paneWidths(drag.tree ?? treeFraction, drag.chat ?? chatFraction, chatOpen);
  const room = 1 - MIN_FILE_PANE_FRACTION;
  // A pane can grow only as far as the file pane's minimum allows, given the other pane's width
  const treeMax = Math.min(MAX_TREE_PANE_FRACTION, room - widths.chat);
  const chatMax = Math.min(MAX_CHAT_PANE_FRACTION, room - widths.tree);
  const clampTree = (value: number) => clamp(value, MIN_TREE_PANE_FRACTION, Math.max(MIN_TREE_PANE_FRACTION, treeMax));
  const clampChat = (value: number) => clamp(value, MIN_CHAT_PANE_FRACTION, Math.max(MIN_CHAT_PANE_FRACTION, chatMax));

  const at = (clientX: number) => {
    const rect = container.current!.getBoundingClientRect();
    return rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
  };

  return (
    <div ref={container} className="flex h-full min-h-0 w-full">
      <div className="h-full min-w-0 overflow-hidden" style={{ width: `${widths.tree * 100}%` }}>
        {left}
      </div>
      <Separator
        label="Resize the folder pane"
        value={widths.tree}
        min={MIN_TREE_PANE_FRACTION}
        max={treeMax}
        onDrag={(clientX) => setDrag({ tree: clampTree(at(clientX)) })}
        onDrop={(clientX) => {
          onTreeFractionChange(clampTree(at(clientX)));
          setDrag({});
        }}
        onKey={(delta) => onTreeFractionChange(clampTree(widths.tree + delta))}
      />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">{center}</div>
      {chatOpen && (
        <>
          <Separator
            label="Resize the chat pane"
            value={widths.chat}
            min={MIN_CHAT_PANE_FRACTION}
            max={chatMax}
            // Dragging left widens the chat pane
            onDrag={(clientX) => setDrag({ chat: clampChat(1 - at(clientX)) })}
            onDrop={(clientX) => {
              onChatFractionChange(clampChat(1 - at(clientX)));
              setDrag({});
            }}
            onKey={(delta) => onChatFractionChange(clampChat(widths.chat - delta))}
          />
          <div className="h-full min-w-0 overflow-hidden" style={{ width: `${widths.chat * 100}%` }}>
            {right}
          </div>
        </>
      )}
    </div>
  );
}

/** A vertical drag bar between two panes; the arrow keys move it too. */
function Separator({
  label,
  value,
  min,
  max,
  onDrag,
  onDrop,
  onKey,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onDrag: (clientX: number) => void;
  onDrop: (clientX: number) => void;
  /** Called with the bar's movement to the right, as a fraction. */
  onKey: (delta: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(Math.max(min, max) * 100)}
      tabIndex={0}
      className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onDrag(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging) onDrag(event.clientX);
      }}
      onPointerUp={(event) => {
        if (!dragging) return;
        setDragging(false);
        onDrop(event.clientX);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft") onKey(-STEP);
        if (event.key === "ArrowRight") onKey(STEP);
      }}
    />
  );
}
