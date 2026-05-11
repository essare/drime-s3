import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createTestQueryClient,
  mockFetchByUrl,
  renderWithProviders,
} from "@/test/utils";
import DashboardPage from "./dashboard";

let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function defaultStatus() {
  return jsonResponse({
    env: {
      drimeApiKeySet: true,
      drimeApiBaseUrl: "https://drime.example",
      s3KeysSet: true,
      region: "drime",
      webUiPasswordSet: true,
    },
    drime: { reachable: true, latencyMs: 87 },
    workspace: { name: "drime_admin", id: 1, exists: true },
  });
}

describe("DashboardPage", () => {
  it("renders bucket count, size, object count, workspace status, and top buckets", async () => {
    mockFetchByUrl({
      "/_admin/status": () => defaultStatus(),
      "/_admin/stats": () =>
        jsonResponse({
          buckets: 3,
          totalBytes: 1024 * 1024 * 250 + 500,
          totalObjects: 142,
          perBucket: [
            { name: "alpha", bytes: 1024 * 1024 * 200, objects: 100 },
            { name: "beta", bytes: 1024 * 1024 * 50, objects: 40 },
            { name: "gamma", bytes: 500, objects: 2 },
          ],
        }),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardPage />
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });

    const buckets = await screen.findByRole("region", {
      name: /workspace stats/i,
    });
    expect(buckets).toHaveTextContent("Total buckets");
    expect(buckets).toHaveTextContent("3");
    expect(buckets).toHaveTextContent("Workspace size");
    expect(buckets).toHaveTextContent("250 MB");
    expect(buckets).toHaveTextContent("Total objects");
    expect(buckets).toHaveTextContent("142");
    expect(buckets).toHaveTextContent("drime_admin");
    expect(buckets).toHaveTextContent("Drime reachable in 87 ms");

    const top = await screen.findByRole("region", {
      name: /top buckets by size/i,
    });
    expect(top).toHaveTextContent("alpha");
    expect(top).toHaveTextContent("200 MB");
    expect(top).toHaveTextContent("beta");
    expect(top).toHaveTextContent("50 MB");
    expect(top).toHaveTextContent("gamma");
    expect(within(top).getByRole("link", { name: /alpha/i })).toHaveAttribute(
      "href",
      "/buckets/alpha",
    );
  });

  it("shows empty-state CTA when there are no buckets", async () => {
    mockFetchByUrl({
      "/_admin/status": () => defaultStatus(),
      "/_admin/stats": () =>
        jsonResponse({
          buckets: 0,
          totalBytes: 0,
          totalObjects: 0,
          perBucket: [],
        }),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardPage />
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /create your first bucket/i }),
      ).toBeInTheDocument();
    });
  });

  it("renders error alert when stats endpoint fails", async () => {
    mockFetchByUrl({
      "/_admin/status": () => defaultStatus(),
      "/_admin/stats": () =>
        jsonResponse({ error: { code: "Boom", message: "boom" } }, 500),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardPage />
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Could not load stats")).toBeInTheDocument();
    });
  });
});
