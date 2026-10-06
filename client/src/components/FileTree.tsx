import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Pencil, Trash2 } from "lucide-react";
import type { TreeFolder, TreeNode } from "@specquer/shared/api";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

/** The folder tree: folders and `.md` files, expanded folders remembered, single click opens. */
export interface FileTreeProps {
  root: TreeFolder;
  expanded: ReadonlySet<string>;
  currentFile: string | undefined;
  onToggleFolder: (path: string, expanded: boolean) => void;
  onOpenFile: (path: string) => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
}

export function FileTree(props: FileTreeProps) {
  if (props.root.children.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No Markdown files in this folder.</p>;
  }
  return (
    <ul role="tree" aria-label="Files" className="py-1 text-sm select-none">
      {props.root.children.map((node) => (
        <TreeItem key={node.path} node={node} depth={0} {...props} />
      ))}
    </ul>
  );
}

function TreeItem({ node, depth, ...props }: FileTreeProps & { node: TreeNode; depth: number }) {
  const isFolder = node.kind === "folder";
  const isExpanded = isFolder && props.expanded.has(node.path);
  const isCurrent = node.path === props.currentFile;
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  const Icon = isFolder ? (isExpanded ? FolderOpen : Folder) : FileText;

  return (
    <li role="treeitem" aria-expanded={isFolder ? isExpanded : undefined} aria-selected={isCurrent} aria-label={node.name}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            data-path={node.path}
            className={cn(
              "flex w-full items-center gap-1 py-1 pr-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
              isCurrent && "bg-navigation text-navigation-foreground hover:bg-navigation",
            )}
            style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
            onClick={() => (isFolder ? props.onToggleFolder(node.path, !isExpanded) : props.onOpenFile(node.path))}
          >
            {isFolder ? <Chevron className="size-4 shrink-0 opacity-70" /> : <span className="w-4 shrink-0" />}
            <Icon className="size-4 shrink-0 opacity-80" />
            <span className="truncate">{node.name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => props.onRename(node)}>
            <Pencil /> Rename…
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => props.onDelete(node)}>
            <Trash2 /> Delete…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isExpanded && node.kind === "folder" && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeItem key={child.path} node={child} depth={depth + 1} {...props} />
          ))}
        </ul>
      )}
    </li>
  );
}
