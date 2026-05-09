import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AdminApiError, adminFetchJson } from "@/lib/api";
import { BatchDeleteResponseSchema } from "@/lib/schemas";

type BatchDeleteInput = { bucket: string; keys: string[] };

export function useBatchDeleteObjects() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bucket, keys }: BatchDeleteInput) =>
      adminFetchJson(
        `/_admin/buckets/${encodeURIComponent(bucket)}/objects:batchDelete`,
        {
          method: "POST",
          body: { keys },
          schema: BatchDeleteResponseSchema,
        },
      ),
    onSuccess: (data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "objects", vars.bucket],
      });
      const okCount = data.deleted.length;
      const errCount = data.errors.length;
      if (errCount === 0) {
        toast.success(`Deleted ${okCount} object${okCount === 1 ? "" : "s"}`);
      } else {
        const sample = data.errors
          .slice(0, 3)
          .map((e) => e.key)
          .join(", ");
        toast.warning(
          `Deleted ${okCount}, ${errCount} failed (${sample}${errCount > 3 ? "…" : ""})`,
        );
      }
    },
    onError: (e) => {
      if (e instanceof AdminApiError) {
        if (e.status === 400 && e.code === "BadRequest") toast.error(e.message);
        else toast.error(e.message);
      } else {
        toast.error("Network error");
      }
    },
  });
}
