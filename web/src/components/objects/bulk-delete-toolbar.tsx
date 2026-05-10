import { useState } from "react";
import { toast } from "sonner";

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
import { useBatchDeleteObjects } from "@/hooks/use-batch-delete";

const MAX_KEYS = 1000;

type Props = {
  bucket: string;
  selected: Set<string>;
  onClearSelection: () => void;
  onAfterDelete: () => void;
};

export function BulkDeleteToolbar({
  bucket,
  selected,
  onClearSelection,
  onAfterDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const mutation = useBatchDeleteObjects();
  const n = selected.size;

  function runDelete() {
    mutation.mutate(
      { bucket, keys: [...selected] },
      {
        onSettled: () => {
          setOpen(false);
          onClearSelection();
          onAfterDelete();
        },
      },
    );
  }

  function openConfirm() {
    if (n > MAX_KEYS) {
      toast.error("Select at most 1000 keys");
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <div className="sticky top-0 z-10 -mx-6 flex items-center gap-2 border-y border-border bg-card px-3 py-2">
        <span className="text-sm text-muted-foreground">{n} selected</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
        >
          Clear
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={mutation.isPending}
          onClick={openConfirm}
        >
          {mutation.isPending ? "Deleting…" : "Delete"}
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete objects?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete {n} object{n === 1 ? "" : "s"}? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => runDelete()}
            >
              {mutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
