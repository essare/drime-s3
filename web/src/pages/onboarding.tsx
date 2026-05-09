import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { OnboardingWizard } from "@/components/onboarding/wizard";
import { useStatusQuery } from "@/hooks/use-status";

export default function OnboardingPage() {
  const status = useStatusQuery();
  const navigate = useNavigate();

  useEffect(() => {
    if (status.data?.workspace.exists === true) {
      navigate("/dashboard", { replace: true });
    }
  }, [status.data?.workspace.exists, navigate]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Set up drime-s3
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Finish these steps to connect the gateway to Drime and your workspace.
        </p>
      </div>
      <OnboardingWizard />
    </div>
  );
}
