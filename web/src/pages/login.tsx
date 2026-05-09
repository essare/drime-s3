import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Link,
  type Location,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useHealthQuery } from "@/hooks/use-health";
import { useSessionQuery } from "@/hooks/use-session";
import { AdminApiError, adminFetchJson } from "@/lib/api";
import { sessionKey } from "@/lib/query-keys";
import { LoginResponseSchema } from "@/lib/schemas";

const loginSchema = z.object({
  password: z.string().min(1, "Required"),
});
type LoginInput = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation() as Location & {
    state?: { from?: Location };
  };
  const health = useHealthQuery();
  const session = useSessionQuery();

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { password: "" },
  });

  const mutation = useMutation({
    mutationFn: (input: LoginInput) =>
      adminFetchJson("/_admin/login", {
        method: "POST",
        body: input,
        schema: LoginResponseSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKey });
      const from = location.state?.from?.pathname ?? "/dashboard";
      navigate(from, { replace: true });
    },
    onError: (error) => {
      if (error instanceof AdminApiError) {
        if (error.status === 401) toast.error("Invalid password");
        else if (error.status === 429) {
          const retryAfterSec = (
            error.details as { retryAfterSec?: number } | undefined
          )?.retryAfterSec;
          toast.error(
            retryAfterSec
              ? `Too many attempts — try again in ${retryAfterSec}s`
              : "Too many attempts — slow down",
          );
        } else if (error.status === 503)
          toast.error("Admin UI disabled — see /setup");
        else toast.error(error.message ?? "Login failed");
      } else {
        toast.error("Network error");
      }
    },
  });

  if (session.data?.authenticated === true) {
    return <Navigate to="/dashboard" replace />;
  }

  if (session.isPending || health.isPending) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-8 text-foreground">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-8 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>drime-s3 admin</CardTitle>
          <CardDescription>
            {health.data?.version ? (
              <span className="text-muted-foreground">
                v{health.data.version}
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
              noValidate
            >
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "Logging in…" : "Log in"}
              </Button>
            </form>
          </Form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Admin disabled?{" "}
            <Link className="underline underline-offset-4" to="/setup">
              Setup instructions
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
