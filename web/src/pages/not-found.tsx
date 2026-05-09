import { Link, useLocation } from "react-router-dom";

export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background p-8 text-foreground">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-muted-foreground text-sm">Path: {pathname}</p>
      <Link className="underline" to="/dashboard">
        Go to dashboard
      </Link>
    </main>
  );
}
