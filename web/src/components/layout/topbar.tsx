import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type TopbarProps = {
  title?: string;
};

export function Topbar({ title }: TopbarProps) {
  return (
    <TooltipProvider>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
        <div className="min-w-0 flex-1">
          {title ? (
            <h1 className="truncate text-sm font-medium">{title}</h1>
          ) : null}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button type="button" variant="ghost" size="sm" disabled>
                <LogOut aria-hidden className="size-4" />
                Logout
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Logout (coming soon)</TooltipContent>
        </Tooltip>
      </header>
    </TooltipProvider>
  );
}
