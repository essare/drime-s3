import { Skeleton } from "@/components/ui/skeleton";

export function FullPageSkeleton() {
  return (
    <div className="flex min-h-svh items-center justify-center p-8">
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
    </div>
  );
}
