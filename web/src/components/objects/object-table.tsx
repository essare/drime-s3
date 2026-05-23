import {
  ArrowDown,
  ArrowUp,
  Download,
  Folder,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { FolderSizeCell } from "@/components/objects/folder-size-cell";
import type { Row } from "@/components/objects/row-types";
import { useFolderStatsBatch } from "@/hooks/use-folder-stats";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes, formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ObjectTableProps = {
  bucket: string;
  rows: Row[];
  selected: Set<string>;
  onSelectChange: (next: Set<string>) => void;
  onNavigatePrefix: (newPrefix: string) => void;
  onDownload: (key: string) => void;
  onRequestDelete: (key: string) => void;
  onLoadMore?: () => void;
  hasMore: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  emptyState?: ReactNode;
  toolbarRight?: ReactNode;
};

type SortKey = "name" | "size" | "modified";
type SortDir = "asc" | "desc";

function objectBaseName(key: string): string {
  const trimmed = key.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function compareRows(a: Row, b: Row, key: SortKey, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1;
  if (key === "name") {
    const aName = a.kind === "folder" ? a.name : objectBaseName(a.key);
    const bName = b.kind === "folder" ? b.name : objectBaseName(b.key);
    return sign * aName.localeCompare(bName);
  }
  if (key === "size") {
    if (a.kind !== "object" || b.kind !== "object") return 0;
    return sign * (a.size - b.size);
  }
  return sign * a.lastModified.localeCompare(b.lastModified);
}

export function ObjectTable({
  bucket,
  rows,
  selected,
  onSelectChange,
  onNavigatePrefix,
  onDownload,
  onRequestDelete,
  onLoadMore,
  hasMore,
  isFetching,
  isFetchingNextPage,
  emptyState = "No objects",
  toolbarRight,
}: ObjectTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [visiblePrefixes, setVisiblePrefixes] = useState<Set<string>>(
    () => new Set(),
  );
  const [debouncedPrefixes, setDebouncedPrefixes] = useState<string[]>([]);

  const handleVisibilityChange = useCallback(
    (prefix: string, visible: boolean) => {
      setVisiblePrefixes((prev) => {
        const next = new Set(prev);
        if (visible) next.add(prefix);
        else next.delete(prefix);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedPrefixes(Array.from(visiblePrefixes).sort());
    }, 150);
    return () => window.clearTimeout(handle);
  }, [visiblePrefixes]);

  const folderStatsQuery = useFolderStatsBatch(
    bucket,
    debouncedPrefixes,
    debouncedPrefixes.length > 0,
  );

  const folderSizeByPrefix = folderStatsQuery.data;

  const displayRows = useMemo(() => {
    const folders = rows.filter((r): r is Extract<Row, { kind: "folder" }> => {
      return r.kind === "folder";
    });
    const objects = rows.filter((r): r is Extract<Row, { kind: "object" }> => {
      return r.kind === "object";
    });
    folders.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    const sortedObjects = [...objects].sort((a, b) =>
      compareRows(a, b, sortKey, sortDir),
    );
    return [...folders, ...sortedObjects];
  }, [rows, sortDir, sortKey]);

  const objectKeysOnPage = useMemo(
    () =>
      displayRows
        .filter(
          (r): r is Extract<Row, { kind: "object" }> => r.kind === "object",
        )
        .map((r) => r.key),
    [displayRows],
  );

  const allPageSelected =
    objectKeysOnPage.length > 0 &&
    objectKeysOnPage.every((k) => selected.has(k));
  const somePageSelected = objectKeysOnPage.some((k) => selected.has(k));

  const headerChecked: boolean | "indeterminate" =
    objectKeysOnPage.length === 0
      ? false
      : allPageSelected
        ? true
        : somePageSelected
          ? "indeterminate"
          : false;

  function toggleRowKey(key: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    onSelectChange(next);
  }

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? (
      <ArrowUp className="size-3.5" aria-hidden />
    ) : (
      <ArrowDown className="size-3.5" aria-hidden />
    );
  }

  const showSkeleton = rows.length === 0 && isFetching;
  const showEmpty = rows.length === 0 && !isFetching;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4">
        {toolbarRight ? (
          <div className="flex justify-end">{toolbarRight}</div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all objects on this page"
                  checked={headerChecked}
                  disabled={objectKeysOnPage.length === 0}
                  onCheckedChange={(value) => {
                    const next = new Set(selected);
                    if (value === false) {
                      for (const k of objectKeysOnPage) next.delete(k);
                    } else {
                      for (const k of objectKeysOnPage) next.add(k);
                    }
                    onSelectChange(next);
                  }}
                />
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 font-medium hover:text-foreground",
                  )}
                  onClick={() => toggleSort("name")}
                >
                  Name
                  {sortIndicator("name")}
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 font-medium hover:text-foreground",
                  )}
                  onClick={() => toggleSort("size")}
                >
                  Size
                  {sortIndicator("size")}
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 font-medium hover:text-foreground",
                  )}
                  onClick={() => toggleSort("modified")}
                >
                  Modified
                  {sortIndicator("modified")}
                </button>
              </TableHead>
              <TableHead className="w-12 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {showSkeleton
              ? Array.from({ length: 6 }, (_, i) => `skeleton-${i}`).map(
                  (id) => (
                    <TableRow key={id}>
                      <TableCell>
                        <Skeleton className="h-4 w-4" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-48 max-w-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="ml-auto h-4 w-8" />
                      </TableCell>
                    </TableRow>
                  ),
                )
              : null}

            {!showSkeleton &&
              displayRows.map((row) => {
                if (row.kind === "folder") {
                  return (
                    <TableRow
                      key={`folder:${row.fullPrefix}`}
                      className="cursor-pointer"
                      onClick={() => onNavigatePrefix(row.fullPrefix)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Checkbox
                                disabled
                                aria-label={row.name}
                                checked={false}
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Folders cannot be selected
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2 font-medium">
                          <Folder
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          {row.name}
                        </span>
                      </TableCell>
                      <FolderSizeCell
                        prefix={row.fullPrefix}
                        size={folderSizeByPrefix?.get(row.fullPrefix)?.size}
                        loading={folderStatsQuery.isFetching}
                        onVisibilityChange={handleVisibilityChange}
                      />
                      <TableCell className="text-muted-foreground">
                        {formatRelativeDate(row.lastModified)}
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TableRow>
                  );
                }

                const checked = selected.has(row.key);
                return (
                  <TableRow key={`object:${row.key}`}>
                    <TableCell
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        aria-label={objectBaseName(row.key)}
                        checked={checked}
                        onCheckedChange={(value) =>
                          toggleRowKey(row.key, value === true)
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {objectBaseName(row.key)}
                    </TableCell>
                    <TableCell>{formatBytes(row.size)}</TableCell>
                    <TableCell>
                      {formatRelativeDate(row.lastModified)}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label="Actions"
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onDownload(row.key)}>
                            <Download className="mr-2 size-4" aria-hidden />
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => onRequestDelete(row.key)}
                          >
                            <Trash2 className="mr-2 size-4" aria-hidden />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}

            {showEmpty ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyState}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {hasMore ? (
          <Button
            type="button"
            variant="outline"
            disabled={isFetchingNextPage || !onLoadMore}
            onClick={() => onLoadMore?.()}
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
