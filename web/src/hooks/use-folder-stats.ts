import { useQuery } from "@tanstack/react-query";

import { adminFetchJson } from "@/lib/api";
import { folderStatsKey } from "@/lib/query-keys";
import { FolderStatsResponseSchema } from "@/lib/schemas";

const MAX_PREFIXES_PER_REQUEST = 10;
const STALE_MS = 60_000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function fetchFolderStatsBatch(
  bucket: string,
  prefixes: string[],
): Promise<Map<string, { size: number; objectCount: number }>> {
  const map = new Map<string, { size: number; objectCount: number }>();
  if (prefixes.length === 0) return map;

  const chunks = chunk(prefixes, MAX_PREFIXES_PER_REQUEST);
  for (const group of chunks) {
    const data = await adminFetchJson(
      `/_admin/buckets/${encodeURIComponent(bucket)}/folder-stats`,
      {
        method: "POST",
        schema: FolderStatsResponseSchema,
        body: { prefixes: group },
      },
    );
    for (const s of data.stats) {
      map.set(s.prefix, { size: s.size, objectCount: s.objectCount });
    }
  }
  return map;
}

export function useFolderStatsBatch(
  bucket: string,
  prefixes: string[],
  enabled: boolean,
) {
  const sorted = [...prefixes].sort();
  return useQuery({
    queryKey: folderStatsKey(bucket, sorted),
    queryFn: () => fetchFolderStatsBatch(bucket, sorted),
    enabled: enabled && bucket.length > 0 && sorted.length > 0,
    staleTime: STALE_MS,
    placeholderData: (prev) => prev,
  });
}
