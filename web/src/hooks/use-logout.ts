import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { adminFetchEmpty } from "@/lib/api";
import { adminKey } from "@/lib/query-keys";

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => adminFetchEmpty("/_admin/logout", { method: "POST" }),
    onSettled: () => {
      queryClient.removeQueries({
        queryKey: adminKey,
        predicate: (q) => {
          const k = q.queryKey;
          return Array.isArray(k) && k[0] === "admin" && k[1] !== "health";
        },
      });
      navigate("/login", { replace: true });
    },
  });
}
