import { Navigate, Outlet, useLocation } from "react-router-dom";

import { FullPageSkeleton } from "@/components/feedback/full-page-skeleton";
import { useStatusQuery } from "@/hooks/use-status";

export function OnboardingGate() {
  const location = useLocation();
  const status = useStatusQuery();

  if (status.isPending) {
    return <FullPageSkeleton />;
  }

  // On error, render the outlet anyway — let pages surface the failure rather than blocking the whole app.
  if (status.isError || !status.data) {
    return <Outlet />;
  }

  const onOnboarding = location.pathname === "/onboarding";
  if (status.data.workspace.exists === false && !onOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }
  if (status.data.workspace.exists === true && onOnboarding) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
