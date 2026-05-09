import { Database } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r bg-card md:flex">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Database aria-hidden className="size-5 text-muted-foreground" />
        <span className="text-sm font-semibold tracking-tight">drime-s3</span>
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 p-3">
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
            )
          }
        >
          Dashboard
        </NavLink>
      </nav>
    </aside>
  );
}
