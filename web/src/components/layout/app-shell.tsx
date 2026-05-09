import { ThemeProvider } from "next-themes";
import { Outlet } from "react-router-dom";

import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} forcedTheme="dark">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col md:pl-56">
          <Topbar />
          <main
            id="main-content"
            className="flex-1 overflow-auto p-4 md:p-6"
          >
            <Outlet />
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
