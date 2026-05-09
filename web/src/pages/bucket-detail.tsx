import { Navigate, useParams, useSearchParams } from "react-router-dom";

import { ObjectsBreadcrumbs } from "@/components/objects/breadcrumbs";
import { ObjectTable } from "@/components/objects/object-table";

export default function BucketDetailPage() {
  const { bucket: bucketParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const prefix = searchParams.get("prefix") ?? "";
  const bucket = bucketParam ?? "";

  const setPrefix = (next: string) =>
    setSearchParams(next ? { prefix: next } : {}, { replace: false });

  if (!bucket) return <Navigate to="/dashboard" replace />;

  return (
    <main className="space-y-4 p-6">
      <ObjectsBreadcrumbs
        bucket={bucket}
        prefix={prefix}
        onNavigate={setPrefix}
      />
      <ObjectTable
        rows={[]}
        selected={new Set()}
        onSelectChange={() => {}}
        onNavigatePrefix={setPrefix}
        hasMore={false}
        isFetching={false}
        isFetchingNextPage={false}
      />
    </main>
  );
}
