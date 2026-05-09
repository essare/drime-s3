import { Button } from "@/components/ui/button";
import { useLogout } from "@/hooks/use-logout";

export type TopbarProps = {
  title?: string;
};

export function Topbar({ title }: TopbarProps) {
  const logout = useLogout();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
      <div className="min-w-0 flex-1">
        {title ? (
          <h1 className="truncate text-sm font-medium">{title}</h1>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        Log out
      </Button>
    </header>
  );
}
