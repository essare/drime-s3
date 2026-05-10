import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";

import { AdminApiError, adminFetchJson } from "@/lib/api";
import { statusKey } from "@/lib/query-keys";
import { StatusSchema } from "@/lib/schemas";

type StatusData = z.infer<typeof StatusSchema>;

export function useStatusQuery(opts?: {
  enabled?: boolean;
  refetchInterval?:
    | number
    | false
    | ((query: { state: { data: StatusData | undefined } }) => number | false);
}) {
  return useQuery({
    queryKey: statusKey,
    queryFn: () =>
      adminFetchJson("/_admin/status", { method: "GET", schema: StatusSchema }),
    enabled: opts?.enabled ?? true,
    staleTime: 15_000,
    refetchInterval: opts?.refetchInterval ?? false,
    retry: (failureCount, error) => {
      if (
        error instanceof AdminApiError &&
        (error.status === 401 || error.status === 503)
      ) {
        return false;
      }
      return failureCount < 1;
    },
  });
}
