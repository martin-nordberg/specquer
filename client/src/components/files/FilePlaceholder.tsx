import { FileQuestion } from "lucide-react";

/** A size in bytes, for people. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type PlaceholderReason = "binary" | "not_utf8" | "too_large" | "bad_image";

const messages: Record<PlaceholderReason, string> = {
  binary: "This file type cannot be displayed by Specquer.",
  not_utf8: "This file isn't UTF-8 text, so Specquer can't display it.",
  too_large: "This file is too large to display.",
  bad_image: "This image can't be displayed.",
};

/** A file Specquer can't show (Step 014, R6, R3.8, R5.6, R5.7), with its size. */
export function FilePlaceholder({ reason, size }: { reason: PlaceholderReason; size: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground" data-testid="file-placeholder">
      <FileQuestion className="size-8 opacity-70" aria-hidden="true" />
      <p className="text-sm">{messages[reason]}</p>
      <p className="text-xs">{formatSize(size)}</p>
    </div>
  );
}
