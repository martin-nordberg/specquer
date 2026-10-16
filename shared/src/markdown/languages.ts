import { baseName } from "../paths/paths.ts";
import { extensionOf } from "../paths/kinds.ts";

/**
 * The language of a text file, as the name of one of highlight.js's `common` grammars (the info
 * string of the code block it is shown as), worked out from its name (Step 014, §5.1). It holds
 * no grammars, so the client's main bundle can use it.
 */

/** Lines longer than this aren't highlighted, so rendering stays quick (R3.9, R4.3). */
export const LONG_LINE = 10_000;

/** By extension, in lower case. */
const extensions = new Map<string, string>();
/** By whole name, case included. */
const names = new Map<string, string>();

function add(table: Map<string, string>, language: string, keys: string[]) {
  for (const key of keys) table.set(key, language);
}

add(extensions, "javascript", [".js", ".mjs", ".cjs", ".jsx"]);
add(extensions, "typescript", [".ts", ".mts", ".cts", ".tsx"]);
add(extensions, "json", [".json", ".jsonc", ".json5"]);
add(extensions, "css", [".css"]);
add(extensions, "scss", [".scss"]);
add(extensions, "less", [".less"]);
add(extensions, "xml", [".html", ".htm", ".xhtml", ".vue", ".xml", ".xsd", ".xsl", ".plist"]);
add(extensions, "yaml", [".yaml", ".yml"]);
add(extensions, "markdown", [".markdown", ".mdx"]);
add(extensions, "ini", [".ini", ".cfg", ".toml"]);
add(extensions, "bash", [".sh", ".bash", ".zsh"]);
add(extensions, "python", [".py", ".pyi"]);
add(extensions, "java", [".java"]);
add(extensions, "kotlin", [".kt", ".kts"]);
add(extensions, "c", [".c", ".h"]);
add(extensions, "cpp", [".cpp", ".cc", ".cxx", ".hpp", ".hh"]);
add(extensions, "csharp", [".cs"]);
add(extensions, "vbnet", [".vb"]);
add(extensions, "objectivec", [".m", ".mm"]);
add(extensions, "swift", [".swift"]);
add(extensions, "go", [".go"]);
add(extensions, "rust", [".rs"]);
add(extensions, "php", [".php"]);
add(extensions, "ruby", [".rb"]);
add(extensions, "perl", [".pl", ".pm"]);
add(extensions, "lua", [".lua"]);
add(extensions, "r", [".r"]);
add(extensions, "sql", [".sql"]);
add(extensions, "graphql", [".graphql", ".gql"]);
add(extensions, "diff", [".diff", ".patch"]);
add(extensions, "makefile", [".mk"]);
add(extensions, "wasm", [".wat"]);
add(extensions, "arduino", [".ino"]);

add(names, "json", ["bun.lock"]);
add(names, "ini", [".editorconfig", ".gitconfig"]);
add(names, "bash", [".envrc"]);
add(names, "ruby", ["Gemfile", "Rakefile"]);
add(names, "makefile", ["Makefile", "GNUmakefile"]);

/** The language a file is highlighted as, or `undefined` for plain text. */
export function languageForFile(path: string): string | undefined {
  const name = baseName(path);
  return names.get(name) ?? extensions.get(extensionOf(name));
}

/** Whether a text has a line longer than `LONG_LINE` characters. */
export function hasLongLine(text: string): boolean {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    if (end - start > LONG_LINE) return true;
    start = end + 1;
  }
  return false;
}
