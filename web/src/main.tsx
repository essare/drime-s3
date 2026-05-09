import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";

import App from "./app";
import { ErrorBoundary } from "./components/error-boundary";
import { UnauthorizedRedirect } from "./components/router-handlers";
import { queryClient } from "./lib/query-client";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element missing");

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/_ui">
          <UnauthorizedRedirect />
          <App />
        </BrowserRouter>
        <Toaster richColors theme="dark" position="top-right" closeButton />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
