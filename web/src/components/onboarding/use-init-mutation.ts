import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AdminApiError, adminFetchJson } from "@/lib/api";
import { statusKey } from "@/lib/query-keys";
import { InitResponseSchema } from "@/lib/schemas";

export function useInitMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      adminFetchJson("/_admin/init", {
        method: "POST",
        schema: InitResponseSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: statusKey });
      toast.success("Workspace ready");
    },
    onError: (e) => {
      if (e instanceof AdminApiError) {
        if (e.code === "DrimeApiKeyMissing") {
          toast.error("Set DRIME_API_KEY on the gateway, then retry");
        } else if (e.code === "InitFailed") {
          toast.error(`Workspace init failed: ${e.message}`);
        } else {
          toast.error(e.message);
        }
      } else {
        toast.error("Network error during init");
      }
    },
  });
}
