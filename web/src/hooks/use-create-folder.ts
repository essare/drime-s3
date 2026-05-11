import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetchJson } from "@/lib/api";
import { objectsKey } from "@/lib/query-keys";
import { CreateFolderResponseSchema } from "@/lib/schemas";

export type CreateFolderArgs = {
  bucket: string;
  prefix: string;
  name: string;
};

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bucket, prefix, name }: CreateFolderArgs) => {
      const trimmed = prefix.replace(/^\/+|\/+$/g, "");
      const path = `/_admin/buckets/${encodeURIComponent(bucket)}/folders${trimmed ? `?prefix=${encodeURIComponent(trimmed)}` : ""}`;
      return adminFetchJson(path, {
        method: "POST",
        body: { path: name },
        schema: CreateFolderResponseSchema,
      });
    },
    onSuccess: (_data, { bucket, prefix }) => {
      void qc.invalidateQueries({
        queryKey: objectsKey(bucket, { prefix, delimiter: "/" }),
      });
    },
  });
}
