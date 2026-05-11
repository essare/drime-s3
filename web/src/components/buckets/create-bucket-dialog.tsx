import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

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
import { AdminApiError, adminFetchJson } from "@/lib/api";
import { bucketNameSchema } from "@/lib/bucket-name";
import { bucketsKey, statsKey } from "@/lib/query-keys";
import { BucketCreatedSchema } from "@/lib/schemas";

const formSchema = z.object({
  name: bucketNameSchema,
});

type FormValues = z.infer<typeof formSchema>;

export type CreateBucketDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
};

export function CreateBucketDialog({
  open,
  onOpenChange,
}: CreateBucketDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "" },
  });

  const mutation = useMutation({
    mutationFn: (input: { name: string }) =>
      adminFetchJson("/_admin/buckets", {
        method: "POST",
        body: input,
        schema: BucketCreatedSchema,
      }),
    onSuccess: async ({ name }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bucketsKey }),
        queryClient.invalidateQueries({ queryKey: statsKey }),
      ]);
      toast.success(`Bucket "${name}" created`);
      onOpenChange(false);
      form.reset({ name: "" });
      navigate(`/buckets/${name}`);
    },
    onError: (e) => {
      if (e instanceof AdminApiError) {
        if (e.status === 400 && e.code === "InvalidBucketName") {
          form.setError("name", { message: e.message });
        } else if (e.status === 409 && e.code === "BucketAlreadyExists") {
          form.setError("name", { message: "Bucket already exists" });
        } else {
          toast.error(e.message);
        }
      } else {
        toast.error("Network error creating bucket");
      }
    },
  });

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      form.reset({ name: "" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create bucket</DialogTitle>
          <DialogDescription>
            Bucket names must follow DNS-style rules (lowercase letters,
            numbers, hyphens; 3–63 characters).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bucket name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      placeholder="my-bucket"
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
                {mutation.isPending ? "Creating…" : "Create bucket"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
