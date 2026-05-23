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
  // Only send users to onboarding when Drime is reachable but the workspace
  // still needs setup. If Drime is down, app pages (e.g. dashboard) show their
  // own outage UI instead of forcing onboarding step 2.
  const needsOnboarding =
    status.data.workspace.exists === false && status.data.drime.reachable;
  if (needsOnboarding && !onOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }
  if (status.data.workspace.exists === true && onOnboarding) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
