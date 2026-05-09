import { ArrowDown, ArrowUp, Folder, MoreHorizontal } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import type { Row } from "@/components/objects/row-types";
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
  rows: Row[];
  selected: Set<string>;
  onSelectChange: (next: Set<string>) => void;
  onNavigatePrefix: (newPrefix: string) => void;
  onLoadMore?: () => void;
  hasMore: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  emptyState?: ReactNode;
};

type SortKey = "name" | "size" | "modified";
type SortDir = "asc" | "desc";

function objectBaseName(key: string): string {
  const trimmed = key.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function compareObjects(a: Row, b: Row, key: SortKey, dir: SortDir): number {
  if (a.kind !== "object" || b.kind !== "object") return 0;
  const sign = dir === "asc" ? 1 : -1;
  if (key === "name") {
    return sign * a.key.localeCompare(b.key);
  }
  if (key === "size") {
    return sign * (a.size - b.size);
  }
  return sign * a.lastModified.localeCompare(b.lastModified);
}

export function ObjectTable({
  rows,
  selected,
  onSelectChange,
  onNavigatePrefix,
  onLoadMore,
  hasMore,
  isFetching,
  isFetchingNextPage,
  emptyState = "No objects",
}: ObjectTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const displayRows = useMemo(() => {
    const folders = rows.filter((r): r is Extract<Row, { kind: "folder" }> => {
      return r.kind === "folder";
    });
    const objects = rows.filter((r): r is Extract<Row, { kind: "object" }> => {
      return r.kind === "object";
    });
    folders.sort((a, b) => a.name.localeCompare(b.name));
    const sortedObjects = [...objects].sort((a, b) =>
      compareObjects(a, b, sortKey, sortDir),
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

  function toggleHeader(checked: boolean) {
    const next = new Set(selected);
    if (checked) {
      for (const k of objectKeysOnPage) next.add(k);
    } else {
      for (const k of objectKeysOnPage) next.delete(k);
    }
    onSelectChange(next);
  }

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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all objects on this page"
                  checked={headerChecked}
                  disabled={objectKeysOnPage.length === 0}
                  onCheckedChange={(value) => toggleHeader(value === true)}
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label="Row actions (coming soon)"
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled>
                      Available in Task 19
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
                      <TableCell className="text-muted-foreground">—</TableCell>
                      <TableCell className="text-muted-foreground">—</TableCell>
                      <TableCell
                        className="text-right text-muted-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        ⋯
                      </TableCell>
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
                    <TableCell className="text-right text-muted-foreground">
                      ⋯
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
