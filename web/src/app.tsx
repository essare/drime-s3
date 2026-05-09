import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { PublicSetupGate } from "./components/gates/public-setup-gate";
import { RequireAuth } from "./components/gates/require-auth";
import { AppShell } from "./components/layout/app-shell";

const LoginPage = lazy(() => import("./pages/login"));
const SetupPage = lazy(() => import("./pages/setup"));
const OnboardingPage = lazy(() => import("./pages/onboarding"));
const DashboardPage = lazy(() => import("./pages/dashboard"));
const BucketDetailPage = lazy(() => import("./pages/bucket-detail"));
const NotFoundPage = lazy(() => import("./pages/not-found"));

export default function App() {
  return (
    <Suspense
      fallback={<div className="p-8 text-muted-foreground">Loading…</div>}
    >
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route
          path="/login"
          element={
            <PublicSetupGate>
              <LoginPage />
            </PublicSetupGate>
          }
        />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/buckets/:bucket" element={<BucketDetailPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
