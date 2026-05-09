import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
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

function FullPageSkeleton() {
  return (
    <div className="flex min-h-svh items-center justify-center p-8">
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
    </div>
  );
}
