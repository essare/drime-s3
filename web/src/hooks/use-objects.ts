import { useInfiniteQuery } from "@tanstack/react-query";
import type { z } from "zod";

import type { Row } from "@/components/objects/row-types";
import { adminFetchJson } from "@/lib/api";
import { objectsKey } from "@/lib/query-keys";
import { ListingSchema } from "@/lib/schemas";

export type UseObjectsParams = {
  bucket: string;
  prefix: string;
};

type Listing = z.infer<typeof ListingSchema>;

function stripListingPrefix(full: string, base: string): string {
  if (!base) return full;
  return full.startsWith(base) ? full.slice(base.length) : full;
}

export function flattenListings(pages: Listing[] | undefined): Row[] {
  if (!pages?.length) return [];
  const folders: Row[] = [];
  const files: Row[] = [];

  for (const page of pages) {
    for (const cp of page.commonPrefixes) {
      const prefix = cp;
      const name = stripListingPrefix(cp, page.prefix).replace(/\/$/, "");
      folders.push({ kind: "folder", name, fullPrefix: prefix });
    }
    for (const o of page.objects) {
      files.push({
        kind: "object",
        key: o.key,
        size: o.size,
        lastModified: o.lastModified,
        etag: o.etag,
      });
    }
  }

  folders.sort((a, b) => {
    if (a.kind !== "folder" || b.kind !== "folder") return 0;
    return a.name.localeCompare(b.name);
  });
  files.sort((a, b) => {
    if (a.kind !== "object" || b.kind !== "object") return 0;
    return a.key.localeCompare(b.key);
  });

  return [...folders, ...files];
}

export function useObjectsQuery({ bucket, prefix }: UseObjectsParams) {
  return useInfiniteQuery({
    queryKey: objectsKey(bucket, { prefix, delimiter: "/" }),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const url = new URL(
        `/_admin/buckets/${encodeURIComponent(bucket)}/objects`,
        window.location.origin,
      );
      if (prefix) url.searchParams.set("prefix", prefix);
      url.searchParams.set("delimiter", "/");
      if (pageParam) url.searchParams.set("token", pageParam);
      url.searchParams.set("max", "1000");
      return adminFetchJson(url.pathname + url.search, {
        method: "GET",
        schema: ListingSchema,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextToken ?? undefined,
    enabled: bucket.length > 0,
    staleTime: 5_000,
  });
}
