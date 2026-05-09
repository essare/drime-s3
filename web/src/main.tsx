import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";

import App from "./app";
import { queryClient } from "./lib/query-client";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element missing");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/_ui">
        <App />
      </BrowserRouter>
      <Toaster richColors theme="dark" position="top-right" closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
