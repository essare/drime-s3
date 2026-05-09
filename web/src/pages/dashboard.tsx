import { Package, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { CreateBucketDialog } from "@/components/buckets/create-bucket-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBucketsQuery } from "@/hooks/use-buckets";
import { useStatusQuery } from "@/hooks/use-status";
import { formatRelativeDate } from "@/lib/format";
import type { StatusData } from "@/lib/schemas";

function statusSubtitle(data: StatusData | undefined): string {
  if (!data) return "Loading status…";
  const ws = `Workspace: ${data.workspace.name}`;
  const drime = data.drime.reachable
    ? data.drime.latencyMs !== undefined
      ? `Drime reachable in ${data.drime.latencyMs} ms`
      : "Drime reachable"
    : (data.drime.error ?? "Drime unreachable");
  return `${ws} · ${drime}`;
}

export default function DashboardPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const statusQuery = useStatusQuery();
  const bucketsQuery = useBucketsQuery();

  const count = bucketsQuery.data?.count ?? 0;
  const buckets = bucketsQuery.data?.buckets ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            {bucketsQuery.isLoading ? (
              <Skeleton className="h-9 w-44 max-w-full" aria-hidden />
            ) : (
              `${count} bucket${count === 1 ? "" : "s"}`
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {statusSubtitle(statusQuery.data)}
          </p>
        </div>
        <Button
          type="button"
          className="shrink-0 gap-2"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" aria-hidden />
          New bucket
        </Button>
      </div>

      <CreateBucketDialog open={createOpen} onOpenChange={setCreateOpen} />

      {bucketsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(
            [
              "bucket-skeleton-a",
              "bucket-skeleton-b",
              "bucket-skeleton-c",
              "bucket-skeleton-d",
              "bucket-skeleton-e",
              "bucket-skeleton-f",
            ] as const
          ).map((slotId) => (
            <Card key={slotId} className="overflow-hidden">
              <CardHeader className="space-y-2">
                <Skeleton
                  className="h-8 w-8 rounded-md"
                  data-testid="bucket-skeleton"
                />
                <Skeleton className="h-5 w-32" data-testid="bucket-skeleton" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-3 w-24" data-testid="bucket-skeleton" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : bucketsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>
            {bucketsQuery.error instanceof Error
              ? bucketsQuery.error.message
              : "Failed to load buckets"}
          </AlertDescription>
        </Alert>
      ) : count === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border py-16 text-center">
          <Package
            className="size-12 text-muted-foreground"
            aria-hidden
            strokeWidth={1.25}
          />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              No buckets yet
            </p>
            <p className="text-xs text-muted-foreground">
              Create a bucket to start storing objects.
            </p>
          </div>
          <Button type="button" onClick={() => setCreateOpen(true)}>
            Create your first bucket
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {buckets.map((b) => (
            <Link key={b.name} to={`/buckets/${b.name}`}>
              <Card className="h-full transition-colors hover:bg-accent">
                <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-2">
                  <Package
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <CardTitle className="truncate text-base font-medium leading-tight">
                    {b.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeDate(b.createdAt)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
