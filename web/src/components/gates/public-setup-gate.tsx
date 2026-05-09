import { Navigate, Outlet } from "react-router-dom";

import { FullPageSkeleton } from "@/components/feedback/full-page-skeleton";
import { useHealthQuery } from "@/hooks/use-health";

export function PublicSetupGate() {
  const health = useHealthQuery();

  if (health.isPending) {
    return <FullPageSkeleton />;
  }

  if (health.data?.hasPassword === false) {
    return <Navigate to="/setup" replace />;
  }

  return <Outlet />;
}
