import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useCreateFolder } from "@/hooks/use-create-folder";
import { AdminApiError } from "@/lib/api";
import { folderNameSchema } from "@/lib/folder-name";
import type { CreateFolderResponse } from "@/lib/schemas";

const formSchema = z.object({ name: folderNameSchema });
type FormValues = z.infer<typeof formSchema>;

export type CreateFolderDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  bucket: string;
  prefix: string;
  onSuccess: (data: CreateFolderResponse) => void;
};

export function CreateFolderDialog({
  open,
  onOpenChange,
  bucket,
  prefix,
  onSuccess,
}: CreateFolderDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "" },
  });

  const mutation = useCreateFolder();
  const [generalError, setGeneralError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      form.reset({ name: "" });
      setGeneralError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create folder</DialogTitle>
          <DialogDescription>
            In{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              {prefix || bucket}
            </code>
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => {
              setGeneralError(null);
              mutation.mutate(
                { bucket, prefix, name: values.name },
                {
                  onSuccess: (data) => {
                    toast.success("Folder created");
                    onSuccess(data);
                    handleOpenChange(false);
                  },
                  onError: (e) => {
                    if (e instanceof AdminApiError) {
                      if (e.code === "FolderAlreadyExists") {
                        const isFile =
                          (e.details as { existingKind?: string } | undefined)
                            ?.existingKind === "file";
                        form.setError("name", {
                          message: isFile
                            ? `An object named "${values.name}" already exists at this location.`
                            : `A folder named "${values.name}" already exists at this location.`,
                        });
                      } else if (e.status === 400) {
                        form.setError("name", { message: e.message });
                      } else {
                        setGeneralError(e.message);
                      }
                    } else {
                      setGeneralError("Network error creating folder");
                    }
                  },
                },
              );
            })}
            className="space-y-4"
          >
            {generalError ? (
              <Alert variant="destructive">
                <AlertDescription>{generalError}</AlertDescription>
              </Alert>
            ) : null}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Folder name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      autoFocus
                      placeholder="2026-photos"
                      maxLength={255}
                      disabled={mutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
