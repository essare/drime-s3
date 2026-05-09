import { StepCard, type StepStatus } from "@/components/onboarding/step-card";
import { useInitMutation } from "@/components/onboarding/use-init-mutation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessionQuery } from "@/hooks/use-session";
import { useStatusQuery } from "@/hooks/use-status";

export function OnboardingWizard() {
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

  if (status.isPending || session.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void status.refetch()}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const data = status.data;
  const envOk = data.env.drimeApiKeySet === true;
  const drimeOk = data.drime.reachable === true;
  const wsOk = data.workspace.exists === true;

  const envStatus: StepStatus = envOk ? "complete" : "error";
  const drimeStatus: StepStatus = !envOk
    ? "blocked"
    : drimeOk
      ? "complete"
      : "active";
  const wsStatus: StepStatus = !drimeOk
    ? "blocked"
    : wsOk
      ? "complete"
      : "active";

  const doneCount = [envOk, drimeOk, wsOk].filter(Boolean).length;
  const progressValue = (doneCount / 3) * 100;

  return (
    <div className="flex flex-col gap-6">
      <Progress value={progressValue} aria-label="Onboarding progress" />

      <div className="flex flex-col gap-4">
        <StepCard
          index={1}
          title="Environment"
          status={envStatus}
          description="Gateway environment variables required for Drime and S3."
        >
          <ul className="flex flex-col gap-3 text-sm">
            <li className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">DRIME_API_KEY</span>
              <Badge
                variant="secondary"
                className={
                  data.env.drimeApiKeySet
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : ""
                }
              >
                {data.env.drimeApiKeySet ? "Set" : "Missing"}
              </Badge>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">S3 access keys</span>
              <Badge
                variant="secondary"
                className={
                  data.env.s3KeysSet
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : ""
                }
              >
                {data.env.s3KeysSet ? "Set" : "Missing"}
              </Badge>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Web UI password</span>
              <Badge
                variant="secondary"
                className={
                  data.env.webUiPasswordSet
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : ""
                }
              >
                {data.env.webUiPasswordSet ? "Set" : "Missing"}
              </Badge>
            </li>
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
        </StepCard>

        <StepCard
          index={2}
          title="Drime API"
          status={drimeStatus}
          description="Verify the gateway can reach your Drime deployment."
        >
          <div className="flex flex-col gap-3 text-sm">
            {typeof data.drime.latencyMs === "number" ? (
              <p>
                Reachable in{" "}
                <span className="font-medium">{data.drime.latencyMs} ms</span>
              </p>
            ) : null}
            {data.drime.error ? (
              <p className="text-destructive font-medium">{data.drime.error}</p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void status.refetch()}
            >
              Retry
            </Button>
          </div>
        </StepCard>

        <StepCard
          index={3}
          title="Workspace"
          status={wsStatus}
          description="Create the gateway workspace in Drime."
        >
          {wsStatus === "complete" && data.workspace.id !== null ? (
            <p className="text-sm">
              Workspace{" "}
              <span className="font-medium">{data.workspace.name}</span> ready
              (id #{data.workspace.id})
            </p>
          ) : null}
          {wsStatus === "blocked" ? (
            <p className="text-muted-foreground text-sm">
              Complete the Drime API step before initializing the workspace.
            </p>
          ) : null}
          {wsStatus === "active" ? (
            <Button
              type="button"
              onClick={() => void init.mutate()}
              disabled={init.isPending}
            >
              {init.isPending ? "Initializing…" : "Initialize Workspace"}
            </Button>
          ) : null}
        </StepCard>
      </div>
    </div>
  );
}
