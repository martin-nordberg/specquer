import { type ReactNode, useRef, useState } from "react";
import { clampTreePaneFraction } from "@specquer/shared/uistate";

/** Two panes side by side with a drag bar; the left pane's width is a fraction of the whole. */
export interface SplitPaneProps {
  fraction: number;
  /** Called when a drag or key press ends, with the new fraction. */
  onFractionChange: (fraction: number) => void;
  left: ReactNode;
  right: ReactNode;
}

export function SplitPane({ fraction, onFractionChange, left, right }: SplitPaneProps) {
  const container = useRef<HTMLDivElement>(null);
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const shown = dragFraction ?? fraction;

  const fractionAt = (clientX: number) => {
    const rect = container.current!.getBoundingClientRect();
    return clampTreePaneFraction((clientX - rect.left) / rect.width);
  };

  return (
    <div ref={container} className="flex h-full min-h-0 w-full">
      <div className="h-full min-w-0 overflow-hidden" style={{ width: `${shown * 100}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the folder pane"
        aria-valuenow={Math.round(shown * 100)}
        aria-valuemin={10}
        aria-valuemax={70}
        tabIndex={0}
        className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragFraction(fractionAt(event.clientX));
        }}
        onPointerMove={(event) => {
          if (dragFraction !== null) setDragFraction(fractionAt(event.clientX));
        }}
        onPointerUp={(event) => {
          if (dragFraction === null) return;
          onFractionChange(fractionAt(event.clientX));
          setDragFraction(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onFractionChange(clampTreePaneFraction(fraction - 0.02));
          if (event.key === "ArrowRight") onFractionChange(clampTreePaneFraction(fraction + 0.02));
        }}
      />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">{right}</div>
    </div>
  );
}
