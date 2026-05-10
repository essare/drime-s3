import { useQuery } from "@tanstack/react-query";

import { adminFetchJson } from "@/lib/api";
import { healthKey } from "@/lib/query-keys";
import { HealthSchema } from "@/lib/schemas";

export function useHealthQuery() {
  return useQuery({
    queryKey: healthKey,
    queryFn: () =>
      adminFetchJson("/_admin/health", {
        method: "GET",
        schema: HealthSchema,
      }),
    staleTime: 60_000,
  });
}
