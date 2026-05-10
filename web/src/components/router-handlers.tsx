import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
  registerUnauthorizedHandler,
  resetUnauthorizedHandler,
} from "@/lib/api";
import { adminKey } from "@/lib/query-keys";

export function UnauthorizedRedirect(): null {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      queryClient.removeQueries({
        queryKey: adminKey,
        predicate: (q) => q.queryKey[1] !== "health",
      });
      navigate("/login", { replace: true });
    });
    return () => resetUnauthorizedHandler();
  }, [navigate, queryClient]);

  return null;
}
