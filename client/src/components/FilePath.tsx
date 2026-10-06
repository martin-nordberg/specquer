import { ChevronDown } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { pathSegments } from "@specquer/shared/paths";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The open file's path from the root, as a breadcrumb. Leading folders give way to "…" when the
 * path doesn't fit. Once there are recent files, the file name opens a list of them.
 */

export type PathPart = { kind: "folder"; name: string } | { kind: "ellipsis"; hidden: string[] } | { kind: "file"; name: string };

/** The breadcrumb parts with the first `hidden` folders replaced by one ellipsis. */
export function elidePath(path: string, hidden: number): PathPart[] {
  const segments = pathSegments(path);
  const folders = segments.slice(0, -1);
  const file = segments.at(-1) ?? "";
  const count = Math.min(hidden, folders.length);
  return [
    ...(count > 0 ? [{ kind: "ellipsis" as const, hidden: folders.slice(0, count) }] : []),
    ...folders.slice(count).map((name) => ({ kind: "folder" as const, name })),
    { kind: "file" as const, name: file },
  ];
}

export interface FilePathProps {
  path: string;
  recentFiles: string[];
  onOpenFile: (path: string) => void;
}

export function FilePath({ path, recentFiles, onOpenFile }: FilePathProps) {
  const list = useRef<HTMLOListElement>(null);
  const [hidden, setHidden] = useState(0);
  const folderCount = Math.max(0, pathSegments(path).length - 1);

  // Hide one more leading folder at a time until the path fits
  useLayoutEffect(() => {
    const element = list.current;
    if (element !== null && element.scrollWidth > element.clientWidth && hidden < folderCount) setHidden(hidden + 1);
  });

  // Start again from the full path when the path or the available width changes
  useLayoutEffect(() => {
    setHidden(0);
    const element = list.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) {
        width = element.clientWidth;
        setHidden(0);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [path]);

  const parts = elidePath(path, hidden);
  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList ref={list} className="flex-nowrap overflow-hidden whitespace-nowrap" aria-label="File path">
        {parts.map((part, i) => (
          <Fragment key={i}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className={part.kind === "file" ? "min-w-0" : "shrink-0"}>
              {part.kind === "ellipsis" ? (
                <span title={part.hidden.join("/")}>
                  <BreadcrumbEllipsis />
                </span>
              ) : part.kind === "folder" ? (
                <span>{part.name}</span>
              ) : recentFiles.length === 0 ? (
                <BreadcrumbPage className="truncate font-medium">{part.name}</BreadcrumbPage>
              ) : (
                <RecentFilesMenu name={part.name} recentFiles={recentFiles} onOpenFile={onOpenFile} />
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function RecentFilesMenu({ name, recentFiles, onOpenFile }: { name: string; recentFiles: string[]; onOpenFile: (path: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-w-0 items-center gap-1 rounded-sm px-1 font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={`${name}, recent files`}
      >
        <span className="truncate">{name}</span>
        <ChevronDown className="size-4 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Recent files</DropdownMenuLabel>
        {recentFiles.map((file) => (
          <DropdownMenuItem key={file} onSelect={() => onOpenFile(file)}>
            {file}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
