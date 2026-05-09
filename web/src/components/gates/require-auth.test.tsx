import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, renderWithProviders } from "@/test/utils";
import { RequireAuth } from "./require-auth";

let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockAdminResponses(opts: {
  hasPassword: boolean;
  authenticated: boolean;
}): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.href;

      if (url.includes("/_admin/health")) {
        return new Response(
          JSON.stringify({
            ok: true,
            version: "0.0.0",
            hasPassword: opts.hasPassword,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/_admin/session")) {
        return new Response(
          JSON.stringify({
            authenticated: opts.authenticated,
            expiresAt: opts.authenticated ? "2099-01-01T00:00:00.000Z" : null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("not found", { status: 404 });
    },
  ) as unknown as typeof fetch;
}

describe("RequireAuth", () => {
  it("renders protected content when health and session allow", async () => {
    mockAdminResponses({ hasPassword: true, authenticated: true });
    const client = createTestQueryClient();

    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route
              path="/dashboard"
              element={<div data-testid="protected">ok</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(screen.getByTestId("protected")).toBeInTheDocument();
    });
  });

  it("redirects to /setup when hasPassword is false", async () => {
    mockAdminResponses({ hasPassword: false, authenticated: false });
    const client = createTestQueryClient();

    function PathProbe() {
      const { pathname } = useLocation();
      return <div data-testid="path">{pathname}</div>;
    }

    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/setup" element={<PathProbe />} />
          <Route element={<RequireAuth />}>
            <Route
              path="/dashboard"
              element={<div data-testid="protected">ok</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(screen.getByTestId("path")).toHaveTextContent("/setup");
    });
    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
  });

  it("redirects to /login when not authenticated", async () => {
    mockAdminResponses({ hasPassword: true, authenticated: false });
    const client = createTestQueryClient();

    function PathProbe() {
      const { pathname } = useLocation();
      return <div data-testid="path">{pathname}</div>;
    }

    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/login" element={<PathProbe />} />
          <Route element={<RequireAuth />}>
            <Route
              path="/dashboard"
              element={<div data-testid="protected">ok</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(screen.getByTestId("path")).toHaveTextContent("/login");
    });
    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
  });
});
