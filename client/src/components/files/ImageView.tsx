import { useState } from "react";
import { FilePlaceholder, formatSize } from "./FilePlaceholder";

/** Where the server serves a listed image; `version` makes a changed file a new URL. */
export function imageUrl(path: string, version: string): string {
  return `/api/image?path=${encodeURIComponent(path)}&v=${encodeURIComponent(version)}`;
}

/**
 * An image, view-only (Step 014, R5): scaled down to fit the pane, or at actual size after a
 * click (or Enter), over a checkerboard, with its pixel and file sizes.
 */
export function ImageView({ path, size, version }: { path: string; size: number; version: string }) {
  const [actual, setActual] = useState(false);
  const [pixels, setPixels] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  if (failed) return <FilePlaceholder reason="bad_image" size={size} />;
  return (
    <div className="flex h-full flex-col" data-testid="image-view">
      <div className="flex min-h-0 flex-1 overflow-auto p-4">
        <button
          type="button"
          aria-pressed={actual}
          aria-label={actual ? "Fit to the pane" : "Show at actual size"}
          title={actual ? "Fit to the pane" : "Actual size"}
          className={`checkerboard m-auto shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${actual ? "cursor-zoom-out" : "flex max-h-full max-w-full cursor-zoom-in"}`}
          onClick={() => setActual((value) => !value)}
        >
          <img
            src={imageUrl(path, version)}
            alt={path.slice(path.lastIndexOf("/") + 1)}
            className={actual ? "block max-w-none" : "block max-h-full max-w-full object-contain"}
            onLoad={(event) => setPixels({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
          />
        </button>
      </div>
      <p className="shrink-0 border-t px-3 py-1 text-xs text-muted-foreground" data-testid="image-details">
        {pixels === null ? formatSize(size) : `${pixels.width} × ${pixels.height} pixels · ${formatSize(size)}`}
      </p>
    </div>
  );
}
