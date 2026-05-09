import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const LoginPage = lazy(() => import("./pages/login"));
const SetupPage = lazy(() => import("./pages/setup"));
const OnboardingPage = lazy(() => import("./pages/onboarding"));
const DashboardPage = lazy(() => import("./pages/dashboard"));
const BucketDetailPage = lazy(() => import("./pages/bucket-detail"));
const NotFoundPage = lazy(() => import("./pages/not-found"));

export default function App() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading…</div>}>
      <Routes>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/buckets/:bucket" element={<BucketDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
