import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { useHealthQuery } from "@/hooks/use-health";

type PublicSetupGateProps = {
  children: ReactNode;
};

export function PublicSetupGate({ children }: PublicSetupGateProps) {
  const health = useHealthQuery();

  if (health.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center p-8">
        <div className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
    );
  }

  if (health.data?.hasPassword === false) {
    return <Navigate to="/setup" replace />;
  }

  return children;
}
