import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { ObjectsBreadcrumbs } from "@/components/objects/breadcrumbs";
import { BulkDeleteToolbar } from "@/components/objects/bulk-delete-toolbar";
import { ObjectTable } from "@/components/objects/object-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDeleteObject } from "@/hooks/use-delete-object";
import { flattenListings, useObjectsQuery } from "@/hooks/use-objects";
import { AdminApiError } from "@/lib/api";
import { buildObjectUrl } from "@/lib/object-url";

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

  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const onSelectChange = useCallback((next: Set<string>) => {
    if (next.size > 1000) {
      toast.error("Select at most 1000 keys");
      return;
    }
    setSelected(next);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when bucket or prefix changes
  useEffect(() => {
    setSelected(new Set());
  }, [bucket, prefix]);

  const deleteObject = useDeleteObject();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const handleDownload = useCallback(
    (key: string) => {
      window.open(buildObjectUrl(bucket, key), "_blank", "noopener");
    },
    [bucket],
  );

  const handleRequestDelete = useCallback((key: string) => {
    setPendingDelete(key);
  }, []);

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

      {selected.size > 0 ? (
        <BulkDeleteToolbar
          bucket={bucket}
          selected={selected}
          onClearSelection={() => setSelected(new Set())}
          onAfterDelete={() => setSelected(new Set())}
        />
      ) : null}

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
        selected={selected}
        onSelectChange={onSelectChange}
        onNavigatePrefix={setPrefix}
        onDownload={handleDownload}
        onRequestDelete={handleRequestDelete}
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

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete object?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  Delete{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    {pendingDelete}
                  </code>{" "}
                  from <span className="font-mono">{bucket}</span>? This cannot
                  be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteObject.isPending}
              onClick={() => {
                if (!pendingDelete) return;
                const key = pendingDelete;
                deleteObject.mutate(
                  { bucket, key },
                  { onSettled: () => setPendingDelete(null) },
                );
              }}
            >
              {deleteObject.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
