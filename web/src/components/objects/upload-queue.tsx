import { Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatBytes } from "@/lib/format";
import type { UploadItem, UploadState, UploadStatus } from "@/lib/upload-queue";

function UploadStatusBadge({
  status,
  finalizing,
}: {
  status: UploadStatus;
  finalizing: boolean;
}) {
  const label =
    status === "queued"
      ? "Queued"
      : status === "uploading"
        ? finalizing
          ? "Finalizing"
          : "Uploading"
        : status === "success"
          ? "Done"
          : "Error";
  const variant =
    status === "error"
      ? "destructive"
      : status === "success"
        ? "secondary"
        : "outline";
  return (
    <Badge variant={variant} className="shrink-0">
      {label}
    </Badge>
  );
}

function UploadProgressDetails({ item }: { item: UploadItem }) {
  // Once the browser->gateway transfer is complete the gateway is still
  // forwarding the body to Drime, so we render an indeterminate "Finalizing"
  // line instead of a stuck "100%".
  const finalizing = item.progress >= 100;
  const sent = Math.min(
    item.file.size,
    Math.round((item.progress / 100) * item.file.size),
  );
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-muted-foreground text-xs tabular-nums">
        <span>
          {finalizing ? "Finalizing on server…" : `${item.progress}%`}
        </span>
        <span className="font-mono">
          {formatBytes(sent)} / {formatBytes(item.file.size)}
        </span>
      </div>
      <Progress value={item.progress} />
    </div>
  );
}

type Props = {
  state: UploadState;
  onCancel: (id: string) => void;
  onClearCompleted: () => void;
};

export function UploadQueueSheet({ state, onCancel, onClearCompleted }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.items.length === 0) setOpen(false);
  }, [state.items.length]);

  const inFlightCount = state.items.filter(
    (i) => i.status === "queued" || i.status === "uploading",
  ).length;

  const hasCompleted = state.items.some(
    (i) => i.status === "success" || i.status === "error",
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {state.items.length > 0 ? (
        <SheetTrigger asChild>
          <Button
            type="button"
            size="lg"
            className="fixed right-6 bottom-6 z-40 h-14 rounded-full shadow-lg"
            aria-label="Open upload queue"
          >
            <Upload className="mr-2 size-5" aria-hidden />
            Uploads
            {inFlightCount > 0 ? (
              <Badge variant="secondary" className="ml-2">
                {inFlightCount}
              </Badge>
            ) : null}
          </Button>
        </SheetTrigger>
      ) : null}

      <SheetContent side="right" className="flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle>
            Upload queue
            {inFlightCount > 0 ? (
              <span className="ml-2 font-normal text-muted-foreground text-sm">
                ({inFlightCount} active)
              </span>
            ) : null}
          </SheetTitle>
        </SheetHeader>

        <div
          className="flex max-h-[calc(100vh-8rem)] flex-col gap-4 overflow-y-auto px-4"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {state.items.map((item) => (
            <div
              key={item.id}
              className="space-y-2 border-border border-b pb-3 last:border-0"
            >
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-mono text-xs">
                  {item.relativePath}
                </span>
                <UploadStatusBadge
                  status={item.status}
                  finalizing={
                    item.status === "uploading" && item.progress >= 100
                  }
                />
              </div>
              {item.status === "uploading" ? (
                <UploadProgressDetails item={item} />
              ) : null}
              {item.status === "error" ? (
                <p className="text-destructive text-xs">{item.errorMessage}</p>
              ) : null}
              {item.status === "uploading" || item.status === "queued" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => onCancel(item.id)}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          ))}
        </div>

        <SheetFooter className="sm:flex-col sm:space-x-0">
          {hasCompleted ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={onClearCompleted}
            >
              Clear completed
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
