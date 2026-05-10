import { useQuery } from "@tanstack/react-query";

import { adminFetchJson } from "@/lib/api";
import { bucketsKey } from "@/lib/query-keys";
import { BucketsResponseSchema } from "@/lib/schemas";

export function useBucketsQuery() {
  return useQuery({
    queryKey: bucketsKey,
    queryFn: () =>
      adminFetchJson("/_admin/buckets", {
        method: "GET",
        schema: BucketsResponseSchema,
      }),
    staleTime: 15_000,
  });
}
