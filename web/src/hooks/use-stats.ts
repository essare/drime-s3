import { useQuery } from "@tanstack/react-query";

import { adminFetchJson } from "@/lib/api";
import { statsKey } from "@/lib/query-keys";
import { StatsResponseSchema } from "@/lib/schemas";

export function useStatsQuery() {
  return useQuery({
    queryKey: statsKey,
    queryFn: () =>
      adminFetchJson("/_admin/stats", {
        method: "GET",
        schema: StatsResponseSchema,
      }),
    staleTime: 30_000,
  });
}
