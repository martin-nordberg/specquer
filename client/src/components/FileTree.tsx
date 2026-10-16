import { Anchor, ChevronDown, ChevronRight, File, FileCode, FileImage, FilePlus, FileText, Folder, FolderOpen, FolderPlus, Pencil, Settings, Trash2, TriangleAlert } from "lucide-react";
import type { TreeFolder, TreeNode } from "@specquer/shared/api";
import { type FileKind, fileKind } from "@specquer/shared/paths";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

const fileIcons: Record<FileKind, typeof FileText> = { markdown: FileText, text: FileCode, image: FileImage, binary: File };

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
  /** **Settings…** for a folder: whether it is sectioned, and its prefix. */
  onFolderSettings?: (folder: TreeFolder) => void;
  /** **Add section anchors…** for a folder or a file (Step 015). */
  onAddAnchors?: (node: TreeNode) => void;
  /** **Section problems…** for a folder or a file. */
  onShowProblems?: (node: TreeNode) => void;
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
        <EntryMenu node={props.root} {...props} />
      </ContextMenu>
    </div>
  );
}

/** **New file…** and **New folder…**. */
function NewEntryItems({ folder, onNewFile, onNewFolder }: Pick<FileTreeProps, "onNewFile" | "onNewFolder"> & { folder: TreeFolder }) {
  return (
    <>
      <ContextMenuItem onSelect={() => onNewFile(folder)}>
        <FilePlus /> New file…
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onNewFolder(folder)}>
        <FolderPlus /> New folder…
      </ContextMenuItem>
    </>
  );
}

/** **Add section anchors…**, **Settings…** (folders only) and **Section problems…**. */
function SectionItems({ node, onAddAnchors, onFolderSettings, onShowProblems }: Pick<FileTreeProps, "onAddAnchors" | "onFolderSettings" | "onShowProblems"> & { node: TreeNode }) {
  return (
    <>
      {onAddAnchors !== undefined && (
        <ContextMenuItem onSelect={() => onAddAnchors(node)}>
          <Anchor /> Add section anchors…
        </ContextMenuItem>
      )}
      {node.kind === "folder" && onFolderSettings !== undefined && (
        <ContextMenuItem onSelect={() => onFolderSettings(node)}>
          <Settings /> Settings…
        </ContextMenuItem>
      )}
      {onShowProblems !== undefined && (
        <ContextMenuItem onSelect={() => onShowProblems(node)}>
          <TriangleAlert /> Section problems…
        </ContextMenuItem>
      )}
    </>
  );
}

/**
 * An entry's menu (Step 015): the same for every folder and every file, Markdown or not; a
 * dialog says when its action doesn't apply. The root folder has no **Rename…** or **Delete…**.
 */
function EntryMenu({ node, ...props }: FileTreeProps & { node: TreeNode }) {
  const root = node.path === "";
  return (
    <ContextMenuContent>
      {node.kind === "folder" && (
        <>
          <NewEntryItems folder={node} {...props} />
          <ContextMenuSeparator />
        </>
      )}
      {!root && (
        <>
          <ContextMenuItem onSelect={() => props.onRename(node)}>
            <Pencil /> Rename…
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => props.onDelete(node)}>
            <Trash2 /> Delete…
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <SectionItems node={node} {...props} />
    </ContextMenuContent>
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
      <ContextMenu>
        <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
        <EntryMenu node={node} {...props} />
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
