import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createTestQueryClient,
  mockFetchByUrl,
  renderWithProviders,
} from "@/test/utils";
import { OnboardingGate } from "./onboarding-gate";

let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function statusJson(
  workspaceExists: boolean,
  opts?: { reachable?: boolean; error?: string },
) {
  const reachable = opts?.reachable ?? true;
  return () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          env: {
            drimeApiKeySet: true,
            drimeApiBaseUrl: "https://api.example",
            s3KeysSet: true,
            region: "drime",
            webUiPasswordSet: true,
          },
          drime: {
            reachable,
            latencyMs: reachable ? 1 : 0,
            ...(reachable
              ? {}
              : { error: opts?.error ?? "connection refused" }),
          },
          workspace: {
            name: "gw",
            id: workspaceExists ? 1 : null,
            exists: workspaceExists,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
}

describe("OnboardingGate", () => {
  it("redirects to /onboarding when workspace missing and path is /dashboard", async () => {
    mockFetchByUrl({
      "/_admin/status": statusJson(false),
    });
    const client = createTestQueryClient();

    function PathProbe() {
      const { pathname } = useLocation();
      return <div data-testid="path">{pathname}</div>;
    }

    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/onboarding" element={<PathProbe />} />
          <Route element={<OnboardingGate />}>
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
      expect(screen.getByTestId("path")).toHaveTextContent("/onboarding");
    });
    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
  });

  it("renders dashboard when workspace missing but Drime is unreachable", async () => {
    mockFetchByUrl({
      "/_admin/status": statusJson(false, { reachable: false }),
    });
    const client = createTestQueryClient();

    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route element={<OnboardingGate />}>
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

  it("renders outlet when workspace exists on /dashboard", async () => {
    mockFetchByUrl({
      "/_admin/status": statusJson(true),
    });
    const client = createTestQueryClient();

    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route element={<OnboardingGate />}>
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

  it("does not redirect when workspace missing but already on /onboarding", async () => {
    mockFetchByUrl({
      "/_admin/status": statusJson(false),
    });
    const client = createTestQueryClient();

    renderWithProviders(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route element={<OnboardingGate />}>
            <Route
              path="/onboarding"
              element={<div data-testid="on-page">wizard</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(screen.getByTestId("on-page")).toBeInTheDocument();
    });
    expect(screen.getByTestId("on-page")).toHaveTextContent("wizard");
  });
});
