import { useParams } from "react-router-dom";

export default function BucketDetailPage() {
  const { bucket } = useParams();
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-8 text-foreground">
      <h1 className="text-xl font-semibold">Bucket: {bucket} (placeholder)</h1>
    </main>
  );
}
