import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ObjectsBreadcrumbs } from "@/components/objects/breadcrumbs";
import { ObjectTable } from "@/components/objects/object-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { flattenListings, useObjectsQuery } from "@/hooks/use-objects";
import { AdminApiError } from "@/lib/api";

function BucketNotFound({ bucket }: { bucket: string }) {
  return (
    <main className="flex min-h-[50vh] flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Bucket not found</CardTitle>
          <CardDescription>
            Bucket <span className="font-mono">{bucket}</span> not found.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button type="button" asChild>
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}

export default function BucketDetailPage() {
  const { bucket: bucketParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const prefix = searchParams.get("prefix") ?? "";
  const bucket = bucketParam ?? "";

  const setPrefix = (next: string) =>
    setSearchParams(next ? { prefix: next } : {}, { replace: false });

  const objects = useObjectsQuery({ bucket, prefix });
  const rows = flattenListings(objects.data?.pages);

  const apiError =
    objects.error instanceof AdminApiError ? objects.error : null;

  if (!bucket) return <Navigate to="/dashboard" replace />;

  if (objects.isError && apiError?.code === "NoSuchBucket") {
    return <BucketNotFound bucket={bucket} />;
  }

  const errorMessage =
    objects.error instanceof AdminApiError
      ? objects.error.message
      : objects.error instanceof Error
        ? objects.error.message
        : objects.error
          ? String(objects.error)
          : "Unknown error";

  return (
    <main className="space-y-4 p-6">
      <ObjectsBreadcrumbs
        bucket={bucket}
        prefix={prefix}
        onNavigate={setPrefix}
      />

      {objects.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load objects</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{errorMessage}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => void objects.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <ObjectTable
        rows={rows}
        selected={new Set()}
        onSelectChange={() => {}}
        onNavigatePrefix={setPrefix}
        onLoadMore={() => void objects.fetchNextPage()}
        hasMore={Boolean(objects.hasNextPage)}
        isFetching={objects.isFetching}
        isFetchingNextPage={objects.isFetchingNextPage}
        emptyState={
          objects.isError
            ? null
            : prefix
              ? "No objects under this prefix"
              : "No objects yet"
        }
      />
    </main>
  );
}
