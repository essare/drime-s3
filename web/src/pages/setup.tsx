import { RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useHealthQuery } from "@/hooks/use-health";

export default function SetupPage() {
  const health = useHealthQuery();

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-8 text-foreground">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Admin UI is disabled</CardTitle>
          <CardDescription>
            The gateway is running without an admin password. Set the{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              WEB_UI_PASSWORD
            </code>{" "}
            environment variable on the gateway, then refresh this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>How to enable</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Pass{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  -e WEB_UI_PASSWORD=…
                </code>{" "}
                (or the equivalent for your orchestrator) so the admin API and
                this UI can authenticate operators.
              </p>
            </AlertDescription>
          </Alert>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
            {`docker run -e WEB_UI_PASSWORD=changeme ... drime-s3`}
          </pre>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void health.refetch()}
              disabled={health.isFetching}
            >
              <RefreshCw
                aria-hidden
                className={`size-4 ${health.isFetching ? "animate-spin" : ""}`}
              />
              Check again
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
