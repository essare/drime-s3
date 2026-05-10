import { useQuery } from "@tanstack/react-query";

import { AdminApiError, adminFetchJson } from "@/lib/api";
import { sessionKey } from "@/lib/query-keys";
import { SessionSchema } from "@/lib/schemas";

export function useSessionQuery() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async () => {
      try {
        return await adminFetchJson("/_admin/session", {
          method: "GET",
          schema: SessionSchema,
        });
      } catch (e) {
        if (e instanceof AdminApiError && e.status === 503) {
          return { authenticated: false, expiresAt: null } as const;
        }
        throw e;
      }
    },
    staleTime: 5_000,
    retry: (count, error) => {
      if (
        error instanceof AdminApiError &&
        (error.status === 401 || error.status === 503)
      ) {
        return false;
      }
      return count < 1;
    },
  });
}
