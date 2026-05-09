import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AdminApiError, adminFetchEmpty } from "@/lib/api";
import { buildObjectUrl } from "@/lib/object-url";

type DeleteObjectInput = { bucket: string; key: string };

export function useDeleteObject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bucket, key }: DeleteObjectInput) => {
      const path = buildObjectUrl(bucket, key);
      await adminFetchEmpty(path, { method: "DELETE" });
    },
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "objects", vars.bucket],
      });
      toast.success(`Deleted ${vars.key}`);
    },
    onError: (e) => {
      if (e instanceof AdminApiError) toast.error(e.message);
      else toast.error("Network error");
    },
  });
}
