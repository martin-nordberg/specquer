import type { TreeNode } from "@specquer/shared/api";
import { checkPath, fileKind } from "@specquer/shared/paths";

/** What a folder's or file's menu offers (Step 015). */
export type EntryAction = "new-file" | "new-folder" | "rename" | "delete" | "anchors" | "settings" | "problems";

/** The title of each action's dialog, also used for the message when it doesn't apply. */
export const ACTION_TITLES: Record<EntryAction, (node: TreeNode) => string> = {
  "new-file": () => "New file",
  "new-folder": () => "New folder",
  rename: (node) => `Rename ${node.kind}`,
  delete: (node) => `Delete ${node.kind}`,
  anchors: () => "Add section anchors",
  settings: () => "Folder settings",
  problems: () => "Section problems",
};

/**
 * Why an action doesn't apply to an entry, or `undefined` when it does (Step 015). Every entry
 * has the same menu, so its dialog says why instead: Specquer changes only Markdown files
 * (Step 014), and `.specquer` holds Specquer's own data. The server refuses these too. Whether a
 * path holds sectioned files only the server knows; the anchor and problems dialogs say that.
 */
export function notApplicable(action: EntryAction, node: TreeNode): string | undefined {
  if (!checkPath(node.path).ok) return "Everything in .specquer is Specquer's own data, which Specquer changes itself.";
  if (node.kind === "folder" || fileKind(node.path) === "markdown") return undefined;
  switch (action) {
    case "rename":
      return `Specquer renames and deletes only Markdown files. Rename “${node.name}” outside Specquer.`;
    case "delete":
      return `Specquer renames and deletes only Markdown files. Delete “${node.name}” outside Specquer.`;
    case "anchors":
    case "problems":
      return `Only Markdown files have sections, so “${node.name}” has none.`;
    default:
      return undefined;
  }
}

/** How a dialog names what it acts on. */
export function entryName(node: TreeNode): string {
  return node.path === "" ? "the root folder" : `“${node.name}”`;
}
