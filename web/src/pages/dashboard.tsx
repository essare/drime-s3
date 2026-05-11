import { Activity, Database, HardDrive, Package, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { CreateBucketDialog } from "@/components/buckets/create-bucket-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStatsQuery } from "@/hooks/use-stats";
import { useStatusQuery } from "@/hooks/use-status";
import { formatBytes } from "@/lib/format";
import type { StatusData } from "@/lib/schemas";

function statusLine(data: StatusData | undefined): string {
  if (!data) return "Loading…";
  if (data.drime.reachable) {
    return data.drime.latencyMs !== undefined
      ? `Drime reachable in ${data.drime.latencyMs} ms`
      : "Drime reachable";
  }
  return data.drime.error ?? "Drime unreachable";
}

function StatCard({
  icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-3xl font-semibold tracking-tight">{value}</p>
        )}
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const statsQuery = useStatsQuery();
  const statusQuery = useStatusQuery();

  const stats = statsQuery.data;
  const status = statusQuery.data;
  const isLoading = statsQuery.isLoading;

  const topBuckets = (stats?.perBucket ?? [])
    .slice()
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Workspace overview and storage usage.
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

      {statsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load stats</AlertTitle>
          <AlertDescription>
            {statsQuery.error instanceof Error
              ? statsQuery.error.message
              : "Failed to load workspace statistics"}
          </AlertDescription>
        </Alert>
      ) : null}

      <section
        aria-label="Workspace stats"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          icon={<Package className="size-4" aria-hidden />}
          label="Total buckets"
          value={String(stats?.buckets ?? 0)}
          loading={isLoading}
        />
        <StatCard
          icon={<HardDrive className="size-4" aria-hidden />}
          label="Workspace size"
          value={formatBytes(stats?.totalBytes ?? 0)}
          hint={
            stats
              ? `Across ${stats.buckets} bucket${stats.buckets === 1 ? "" : "s"}`
              : undefined
          }
          loading={isLoading}
        />
        <StatCard
          icon={<Database className="size-4" aria-hidden />}
          label="Total objects"
          value={(stats?.totalObjects ?? 0).toLocaleString()}
          loading={isLoading}
        />
        <StatCard
          icon={<Activity className="size-4" aria-hidden />}
          label="Workspace"
          value={status?.workspace.name ?? "—"}
          hint={statusLine(status)}
          loading={statusQuery.isLoading}
        />
      </section>

      <section aria-label="Top buckets by size" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Top buckets by size
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/buckets">View all</Link>
          </Button>
        </div>
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {(["s-a", "s-b", "s-c"] as const).map((id) => (
                  <Skeleton key={id} className="h-8 w-full" />
                ))}
              </div>
            ) : topBuckets.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No buckets yet —{" "}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => setCreateOpen(true)}
                >
                  create your first bucket
                </button>
                .
              </div>
            ) : (
              <ul className="divide-y">
                {topBuckets.map((b) => (
                  <li key={b.name} className="flex items-center px-4 py-3">
                    <Package
                      className="mr-3 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <Link
                      to={`/buckets/${b.name}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {b.name}
                    </Link>
                    <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        {b.objects.toLocaleString()} object
                        {b.objects === 1 ? "" : "s"}
                      </span>
                      <span className="font-mono">{formatBytes(b.bytes)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
          {!isLoading && topBuckets.length > 0 ? (
            <CardFooter className="justify-center border-t">
              <CardDescription className="text-center">
                Showing the {topBuckets.length} largest bucket
                {topBuckets.length === 1 ? "" : "s"} by size.
              </CardDescription>
            </CardFooter>
          ) : null}
        </Card>
      </section>
    </div>
  );
}
