import { ArrowLeft, ArrowRight, CircleCheck, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { RetryButton } from "@/components/feedback/retry-button";
import { useInitMutation } from "@/components/onboarding/use-init-mutation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessionQuery } from "@/hooks/use-session";
import { useStatusQuery } from "@/hooks/use-status";
import { cn } from "@/lib/utils";

type StepIconState = "ok" | "todo" | "idle";

const TOTAL_STEPS = 3;

export function OnboardingWizard() {
  const [retryInFlight, setRetryInFlight] = useState(false);
  const session = useSessionQuery();
  const init = useInitMutation();
  const status = useStatusQuery({
    enabled: session.data?.authenticated === true,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      if (d.env.drimeApiKeySet && !d.drime.reachable) return 4000;
      return false;
    },
  });

  const [currentStep, setCurrentStep] = useState(1);

  const envOk = status.data?.env.drimeApiKeySet === true;
  const drimeOk = status.data?.drime.reachable === true;
  const wsOk = status.data?.workspace.exists === true;

  const isRetrying = retryInFlight || status.isFetching || status.isRefetching;

  const handleStatusRetry = () => {
    setRetryInFlight(true);
    void status.refetch().finally(() => setRetryInFlight(false));
  };

  // Auto-advance forward as the underlying checks turn green.
  // Never auto-walk backwards: if the user navigated back to inspect a
  // previous step, leave them there until they explicitly click Continue.
  useEffect(() => {
    if (!status.data) return;
    let target = 1;
    if (envOk) target = 2;
    if (envOk && drimeOk) target = 3;
    setCurrentStep((prev) => Math.max(prev, target));
  }, [envOk, drimeOk, status.data]);

  if (status.isPending || session.isPending) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <Skeleton className="mb-4 h-1 w-full" />
        <Skeleton className="mb-2 h-3 w-16" />
        <Skeleton className="mb-2 h-6 w-48" />
        <Skeleton className="mb-4 h-4 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (status.isError || !status.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load gateway status</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>
            {status.error instanceof Error
              ? status.error.message
              : "Unknown error"}
          </span>
          <RetryButton
            className="w-fit"
            size="sm"
            retrying={isRetrying}
            onClick={handleStatusRetry}
          />
        </AlertDescription>
      </Alert>
    );
  }

  const data = status.data;

  function goBack() {
    setCurrentStep((s) => Math.max(1, s - 1));
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <ProgressDots currentStep={currentStep} />

      <p className="text-muted-foreground text-xs">
        Step {currentStep} of {TOTAL_STEPS}
      </p>

      {currentStep === 1 ? (
        <StepContainer
          number={1}
          title="Environment"
          description="Gateway environment variables required to talk to Drime and serve S3."
        >
          <StatusRow
            state={envOk ? "ok" : "todo"}
            title={envOk ? "Environment ready" : "DRIME_API_KEY is missing"}
            sub={
              envOk
                ? "All required environment variables are set."
                : "Set DRIME_API_KEY on the gateway, then click Retry."
            }
            meta="env"
          />
          <ul className="mt-4 grid gap-2 text-xs">
            <EnvBadge label="DRIME_API_KEY" set={data.env.drimeApiKeySet} />
            <EnvBadge label="S3 access keys" set={data.env.s3KeysSet} />
            <EnvBadge label="Web UI password" set={data.env.webUiPasswordSet} />
            <li className="text-muted-foreground">
              Region:{" "}
              <span className="text-foreground font-medium">
                {data.env.region}
              </span>
            </li>
            <li className="text-muted-foreground break-all">
              Drime API:{" "}
              <span className="text-foreground font-medium">
                {data.env.drimeApiBaseUrl}
              </span>
            </li>
          </ul>
        </StepContainer>
      ) : null}

      {currentStep === 2 ? (
        <StepContainer
          number={2}
          title="Drime API"
          description="Verify the gateway can reach your Drime account."
        >
          <StatusRow
            state={drimeOk ? "ok" : "todo"}
            title={drimeOk ? "Drime API reachable" : "Cannot reach Drime API"}
            sub={
              drimeOk ? (
                <>
                  <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.7rem]">
                    {data.env.drimeApiBaseUrl}
                  </code>{" "}
                  responded in{" "}
                  <span className="text-foreground font-medium">
                    {data.drime.latencyMs} ms
                  </span>
                </>
              ) : (
                (data.drime.error ?? "No response from Drime")
              )
            }
            meta="GET /me/workspaces"
          />
        </StepContainer>
      ) : null}

      {currentStep === 3 ? (
        <StepContainer
          number={3}
          title="Initialize workspace"
          description={
            <>
              Create the Drime workspace{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                {data.workspace.name}
              </code>{" "}
              so the gateway can map its root folders to S3 buckets.
            </>
          }
        >
          <StatusRow
            state={wsOk ? "ok" : "todo"}
            title={wsOk ? "Workspace ready" : "Workspace not found"}
            sub={
              wsOk ? (
                <>
                  Workspace{" "}
                  <span className="text-foreground font-medium">
                    {data.workspace.name}
                  </span>{" "}
                  (id #{data.workspace.id}) is ready.
                </>
              ) : (
                <>
                  No workspace named{" "}
                  <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.7rem]">
                    {data.workspace.name}
                  </code>{" "}
                  in your Drime account.
                </>
              )
            }
            meta="POST /workspace"
          />
        </StepContainer>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={goBack}
          disabled={currentStep === 1}
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <PrimaryAction
          step={currentStep}
          envOk={envOk}
          drimeOk={drimeOk}
          wsOk={wsOk}
          isInitializing={init.isPending}
          isRetrying={isRetrying}
          onContinue={() => setCurrentStep((s) => Math.min(TOTAL_STEPS, s + 1))}
          onRetry={handleStatusRetry}
          onInit={() => void init.mutate()}
        />
      </div>
    </div>
  );
}

function ProgressDots({ currentStep }: { currentStep: number }) {
  return (
    <div className="mb-4 flex gap-1.5" aria-hidden>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((idx) => (
        <span
          key={idx}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            idx < currentStep && "bg-emerald-500",
            idx === currentStep && "bg-primary",
            idx > currentStep && "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function StepContainer({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mt-1">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <span className="bg-primary text-primary-foreground inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold">
          {number}
        </span>
        {title}
      </h3>
      <p className="text-muted-foreground mt-1 mb-4 text-sm">{description}</p>
      <div className="bg-background rounded-lg border p-4">{children}</div>
    </div>
  );
}

function StatusRow({
  state,
  title,
  sub,
  meta,
}: {
  state: StepIconState;
  title: ReactNode;
  sub: ReactNode;
  meta?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <StatusIcon state={state} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-muted-foreground text-xs">{sub}</div>
      </div>
      {meta ? (
        <span className="text-muted-foreground shrink-0 font-mono text-[0.7rem]">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

function StatusIcon({ state }: { state: StepIconState }) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
        state === "ok" && "bg-emerald-500",
        state === "todo" && "bg-amber-500",
        state === "idle" &&
          "border-border text-muted-foreground border bg-transparent",
      )}
      aria-hidden
    >
      {state === "ok" ? "✓" : state === "todo" ? "!" : ""}
    </span>
  );
}

function EnvBadge({ label, set }: { label: string; set: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <Badge
        variant="secondary"
        className={
          set
            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : ""
        }
      >
        {set ? "Set" : "Missing"}
      </Badge>
    </li>
  );
}

function PrimaryAction({
  step,
  envOk,
  drimeOk,
  wsOk,
  isInitializing,
  isRetrying,
  onContinue,
  onRetry,
  onInit,
}: {
  step: number;
  envOk: boolean;
  drimeOk: boolean;
  wsOk: boolean;
  isInitializing: boolean;
  isRetrying: boolean;
  onContinue: () => void;
  onRetry: () => void;
  onInit: () => void;
}) {
  if (step === 1) {
    if (envOk) {
      return (
        <Button type="button" onClick={onContinue}>
          Continue
          <ArrowRight className="size-4" />
        </Button>
      );
    }
    return <RetryButton retrying={isRetrying} onClick={onRetry} />;
  }

  if (step === 2) {
    if (drimeOk) {
      return (
        <Button type="button" onClick={onContinue}>
          Continue
          <ArrowRight className="size-4" />
        </Button>
      );
    }
    return <RetryButton retrying={isRetrying} onClick={onRetry} />;
  }

  if (wsOk) {
    return (
      <Badge
        variant="secondary"
        className="border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-emerald-700 dark:text-emerald-400"
      >
        <CircleCheck className="size-3.5" aria-hidden />
        Workspace ready
      </Badge>
    );
  }

  return (
    <Button type="button" onClick={onInit} disabled={isInitializing}>
      {isInitializing ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Initializing…
        </>
      ) : (
        "Initialize Workspace"
      )}
    </Button>
  );
}
