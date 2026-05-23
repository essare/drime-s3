import { FolderPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { ObjectsBreadcrumbs } from "@/components/objects/breadcrumbs";
import { BulkDeleteToolbar } from "@/components/objects/bulk-delete-toolbar";
import { CreateFolderDialog } from "@/components/objects/create-folder-dialog";
import { DropOverlay } from "@/components/objects/drop-overlay";
import { ObjectTable } from "@/components/objects/object-table";
import { UploadQueueSheet } from "@/components/objects/upload-queue";
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
import { useUploadQueue } from "@/hooks/use-upload-queue";
import { AdminApiError } from "@/lib/api";
import { collectDropEnqueueArgs } from "@/lib/collect-drop-files";
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const {
    state: uploadState,
    enqueue,
    cancel,
    clearCompleted,
  } = useUploadQueue({ bucket, prefix });

  /**
   * Overlay visibility: `dragenter` turns the overlay on; `dragleave` only turns it off when
   * `relatedTarget` is outside `document.documentElement`, so moving across nested nodes does not
   * hide the overlay. We use `setDragDepth(1)` (not an accumulating counter) so repeated `dragenter`
   * events from nested elements cannot strand the overlay with depth above one.
   */
  const [dragDepth, setDragDepth] = useState(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      [...(e.dataTransfer?.types ?? [])].includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragDepth(1);
    };

    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const related = e.relatedTarget as Node | null;
      if (related && document.documentElement.contains(related)) return;
      setDragDepth(0);
    };

    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragDepth(0);
      const dt = e.dataTransfer;
      if (!dt) return;
      void collectDropEnqueueArgs(dt).then((args) => {
        enqueue(args);
      });
    };

    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("dragover", onOver);
    document.addEventListener("drop", onDrop);

    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [enqueue]);

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
      <DropOverlay visible={dragDepth > 0} />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          enqueue(files.map((file) => ({ file })));
          e.target.value = "";
        }}
      />
      <UploadQueueSheet
        state={uploadState}
        onCancel={cancel}
        onClearCompleted={clearCompleted}
      />

      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        bucket={bucket}
        prefix={prefix}
        onSuccess={(data) => setSearchParams({ prefix: data.prefix })}
      />

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
        bucket={bucket}
        rows={rows}
        selected={selected}
        onSelectChange={onSelectChange}
        onNavigatePrefix={setPrefix}
        onDownload={handleDownload}
        onRequestDelete={handleRequestDelete}
        toolbarRight={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateFolderOpen(true)}
            >
              <FolderPlus className="size-4" aria-hidden />
              New folder
            </Button>
            <Button type="button" onClick={() => fileInputRef.current?.click()}>
              Upload
            </Button>
          </div>
        }
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
