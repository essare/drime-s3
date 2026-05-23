import { useEffect, useRef } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { TableCell } from "@/components/ui/table";
import { formatBytes } from "@/lib/format";

export function FolderSizeCell({
  prefix,
  size,
  loading,
  onVisibilityChange,
}: {
  prefix: string;
  size: number | undefined;
  loading: boolean;
  onVisibilityChange: (prefix: string, visible: boolean) => void;
}) {
  const ref = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        onVisibilityChange(prefix, entry?.isIntersecting ?? false);
      },
      { rootMargin: "120px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      onVisibilityChange(prefix, false);
    };
  }, [prefix, onVisibilityChange]);

  return (
    <TableCell ref={ref} className="text-muted-foreground tabular-nums">
      {loading && size === undefined ? (
        <Skeleton className="h-4 w-14" />
      ) : size !== undefined ? (
        formatBytes(size)
      ) : (
        "—"
      )}
    </TableCell>
  );
}
