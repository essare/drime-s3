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

export type DeleteBucketDialogProps = {
  bucket: { name: string } | null;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
};

export function DeleteBucketDialog({
  bucket,
  onClose,
  onConfirm,
  pending,
}: DeleteBucketDialogProps) {
  const open = bucket !== null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete bucket?</AlertDialogTitle>
          <AlertDialogDescription>
            Permanently delete bucket{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {bucket?.name}
            </code>
            . This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button" onClick={onClose}>
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
