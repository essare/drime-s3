import { Navigate, Outlet, useLocation } from "react-router-dom";

import { FullPageSkeleton } from "@/components/feedback/full-page-skeleton";
import { useHealthQuery } from "@/hooks/use-health";
import { useSessionQuery } from "@/hooks/use-session";

export function RequireAuth() {
  const location = useLocation();
  const health = useHealthQuery();
  const session = useSessionQuery();

  if (health.isPending || session.isPending) {
    return <FullPageSkeleton />;
  }

  if (health.data?.hasPassword === false) {
    return <Navigate to="/setup" replace />;
  }

  if (session.data?.authenticated !== true) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
