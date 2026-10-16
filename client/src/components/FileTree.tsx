import { ChevronDown, ChevronRight, File, FileCode, FileImage, FilePlus, FileText, Folder, FolderOpen, FolderPlus, Pencil, Settings, Trash2, TriangleAlert } from "lucide-react";
import type { TreeFolder, TreeNode } from "@specquer/shared/api";
import { type FileKind, checkPath, fileKind } from "@specquer/shared/paths";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

const fileIcons: Record<FileKind, typeof FileText> = { markdown: FileText, text: FileCode, image: FileImage, binary: File };

/**
 * Whether Specquer can change an entry (Step 014, R2.3): folders and Markdown files, but nothing
 * in `.specquer`, which no route that writes accepts.
 */
function changeable(node: TreeNode): boolean {
  return checkPath(node.path).ok && (node.kind === "folder" || fileKind(node.path) === "markdown");
}

/** The folder tree, in either view: expanded folders remembered, single click opens. */
export interface FileTreeProps {
  root: TreeFolder;
  /** Shown when the tree is empty. */
  emptyMessage?: string;
  expanded: ReadonlySet<string>;
  currentFile: string | undefined;
  onToggleFolder: (path: string, expanded: boolean) => void;
  onOpenFile: (path: string) => void;
  onNewFile: (folder: TreeFolder) => void;
  onNewFolder: (folder: TreeFolder) => void;
  /** **Settings…** for a folder: whether it is sectioned, its prefix, and adding section anchors. */
  onFolderSettings?: (folder: TreeFolder) => void;
  /** **Section problems…** for a folder. */
  onShowProblems?: (folder: TreeFolder) => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
}

export function FileTree(props: FileTreeProps) {
  return (
    <div className="flex flex-[1_0_auto] flex-col">
      {props.root.children.length > 0 && (
        <ul role="tree" aria-label="Files" className="pt-1 text-sm select-none">
          {props.root.children.map((node) => (
            <TreeItem key={node.path} node={node} depth={0} {...props} />
          ))}
        </ul>
      )}
      {/* The space below the last entry stands for the root folder */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div data-path="" className="min-h-8 flex-1">
            {props.root.children.length === 0 && <p className="p-4 text-sm text-muted-foreground">{props.emptyMessage ?? "No Markdown files in this folder."}</p>}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <NewEntryItems folder={props.root} {...props} />
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function NewEntryItems({
  folder,
  onNewFile,
  onNewFolder,
  onFolderSettings,
  onShowProblems,
}: Pick<FileTreeProps, "onNewFile" | "onNewFolder" | "onFolderSettings" | "onShowProblems"> & { folder: TreeFolder }) {
  return (
    <>
      <ContextMenuItem onSelect={() => onNewFile(folder)}>
        <FilePlus /> New file…
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onNewFolder(folder)}>
        <FolderPlus /> New folder…
      </ContextMenuItem>
      {onFolderSettings !== undefined && (
        <ContextMenuItem onSelect={() => onFolderSettings(folder)}>
          <Settings /> Settings…
        </ContextMenuItem>
      )}
      {onShowProblems !== undefined && (
        <ContextMenuItem onSelect={() => onShowProblems(folder)}>
          <TriangleAlert /> Section problems…
        </ContextMenuItem>
      )}
    </>
  );
}

function TreeItem({ node, depth, ...props }: FileTreeProps & { node: TreeNode; depth: number }) {
  const isFolder = node.kind === "folder";
  const isExpanded = isFolder && props.expanded.has(node.path);
  const isCurrent = node.path === props.currentFile;
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  const Icon = isFolder ? (isExpanded ? FolderOpen : Folder) : fileIcons[fileKind(node.path)];
  const button = (
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
      <Icon className={cn("size-4 shrink-0 opacity-80", isFolder && "fill-folder")} />
      <span className="truncate">{node.name}</span>
    </button>
  );

  return (
    <li role="treeitem" aria-expanded={isFolder ? isExpanded : undefined} aria-selected={isCurrent} aria-label={node.name}>
      {!changeable(node) ? (
        button
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
          <ContextMenuContent>
            {node.kind === "folder" && (
              <>
                <NewEntryItems folder={node} {...props} />
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onSelect={() => props.onRename(node)}>
              <Pencil /> Rename…
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => props.onDelete(node)}>
              <Trash2 /> Delete…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
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
