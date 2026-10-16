import { baseName, isMarkdownFile } from "./paths.ts";

/**
 * What kind of file a name is, worked out from the name alone, so the tree needn't read the
 * files (Step 014, §5.2). A `text` file may still turn out not to be text when it is opened.
 */
export type FileKind = "markdown" | "image" | "text" | "binary";

/** The image types Specquer shows, by extension, with the `Content-Type` they are served with (R5.1). */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

/** Extensions of files known not to be text, which the tree marks as such without reading them. */
export const KNOWN_BINARY_EXTENSIONS: ReadonlySet<string> = new Set(
  [
    ...[".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".tar", ".jar", ".war"],
    ...[".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".class", ".pyc", ".wasm", ".lockb"],
    ...[".woff", ".woff2", ".ttf", ".otf", ".eot"],
    ...[".db", ".sqlite", ".sqlite3"],
    ...[".mp3", ".mp4", ".mov", ".avi", ".mkv", ".wav", ".flac", ".ogg", ".webm", ".m4a"],
    ...[".tif", ".tiff", ".heic", ".psd", ".ai", ".sketch", ".fig"],
    ...[".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".dmg", ".iso"],
  ],
);

/** A name's extension in lower case, with its dot ("" for none, and for names like `.gitignore`). */
export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** The `Content-Type` of an image Specquer shows, or `undefined` for any other file. */
export function imageType(path: string): string | undefined {
  return IMAGE_TYPES[extensionOf(path)];
}

export function fileKind(path: string): FileKind {
  if (isMarkdownFile(path)) return "markdown";
  if (imageType(path) !== undefined) return "image";
  return KNOWN_BINARY_EXTENSIONS.has(extensionOf(path)) ? "binary" : "text";
}
