import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AdminApiError, adminFetchEmpty } from "@/lib/api";
import { bucketsKey, statsKey } from "@/lib/query-keys";

export function useDeleteBucket() {
  const queryClient = useQueryClient();
  const invalidateBucketViews = () => {
    void queryClient.invalidateQueries({ queryKey: bucketsKey });
    void queryClient.invalidateQueries({ queryKey: statsKey });
  };
  return useMutation({
    mutationFn: ({ name }: { name: string }) =>
      adminFetchEmpty(`/_admin/buckets/${encodeURIComponent(name)}`, {
        method: "DELETE",
      }),
    onSuccess: (_, vars) => {
      invalidateBucketViews();
      toast.success(`Bucket "${vars.name}" deleted`);
    },
    onError: (e, vars) => {
      if (e instanceof AdminApiError) {
        if (e.status === 409 && e.code === "BucketNotEmpty") {
          toast.error(`Bucket "${vars.name}" is not empty`, {
            description: "Delete its objects first, then retry.",
          });
        } else if (e.status === 404 && e.code === "NoSuchBucket") {
          toast.error("Bucket no longer exists");
          invalidateBucketViews();
        } else {
          toast.error(e.message);
        }
      } else {
        toast.error("Network error");
      }
    },
  });
}
