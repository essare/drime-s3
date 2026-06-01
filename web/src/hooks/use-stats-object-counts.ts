import { useQuery } from "@tanstack/react-query";

import { adminFetchJson } from "@/lib/api";
import { statsObjectCountsKey } from "@/lib/query-keys";
import { StatsObjectCountsResponseSchema } from "@/lib/schemas";

export function useStatsObjectCountsQuery(enabled: boolean) {
  return useQuery({
    queryKey: statsObjectCountsKey,
    queryFn: () =>
      adminFetchJson("/_admin/stats/object-counts", {
        method: "GET",
        schema: StatsObjectCountsResponseSchema,
      }),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
}
