import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      name: /workspace overview/i,
    });
    expect(buckets).toHaveTextContent("Total buckets");
    expect(buckets).toHaveTextContent("3");
    expect(buckets).toHaveTextContent("Workspace size");
    expect(buckets).toHaveTextContent("250 MB");
    expect(buckets).toHaveTextContent("Total objects");
    expect(buckets).toHaveTextContent("142");
    expect(buckets).toHaveTextContent("drime_admin");
    expect(buckets).toHaveTextContent("Drime reachable in");
    expect(screen.getByText("87 ms")).toHaveClass("text-emerald-500");

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

  it("shows centered blocking error when stats endpoint fails", async () => {
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
      expect(
        screen.getByRole("alert", { name: /could not load workspace stats/i }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Could not load stats")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /new bucket/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /workspace overview/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows blocking error when status endpoint fails", async () => {
    mockFetchByUrl({
      "/_admin/status": () =>
        jsonResponse({ error: { code: "Boom", message: "gateway down" } }, 500),
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

    expect(
      await screen.findByRole(
        "alert",
        { name: /could not reach gateway/i },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("gateway down")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /workspace overview/i }),
    ).not.toBeInTheDocument();
  });

  it("shows blocking error when Drime is unreachable", async () => {
    mockFetchByUrl({
      "/_admin/status": () =>
        jsonResponse({
          env: {
            drimeApiKeySet: true,
            drimeApiBaseUrl: "https://drime.example",
            s3KeysSet: true,
            region: "drime",
            webUiPasswordSet: true,
          },
          drime: { reachable: false, latencyMs: 3000, error: "timeout" },
          workspace: { name: "drime_admin", id: null, exists: false },
        }),
      "/_admin/stats": () =>
        jsonResponse({
          buckets: 1,
          totalBytes: 100,
          totalObjects: 1,
          perBucket: [{ name: "a", bytes: 100, objects: 1 }],
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
        screen.getByRole("alert", { name: /drime api unavailable/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /workspace overview/i }),
    ).not.toBeInTheDocument();
  });

  it("recovers dashboard after Retry when APIs succeed", async () => {
    const user = userEvent.setup();
    let statsFail = true;

    mockFetchByUrl({
      "/_admin/status": () => defaultStatus(),
      "/_admin/stats": () => {
        if (statsFail) {
          return jsonResponse(
            { error: { code: "Boom", message: "boom" } },
            500,
          );
        }
        return jsonResponse({
          buckets: 1,
          totalBytes: 100,
          totalObjects: 1,
          perBucket: [{ name: "a", bytes: 100, objects: 1 }],
        });
      },
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
        screen.getByRole("button", { name: /retry/i }),
      ).toBeInTheDocument();
    });

    statsFail = false;
    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: /workspace overview/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    { ms: 100, expectedClass: "text-emerald-500" },
    { ms: 800, expectedClass: "text-amber-500" },
    { ms: 2000, expectedClass: "text-red-500" },
  ])("colors latency $ms ms with $expectedClass", async ({
    ms,
    expectedClass,
  }) => {
    mockFetchByUrl({
      "/_admin/status": () =>
        jsonResponse({
          env: {
            drimeApiKeySet: true,
            drimeApiBaseUrl: "https://drime.example",
            s3KeysSet: true,
            region: "drime",
            webUiPasswordSet: true,
          },
          drime: { reachable: true, latencyMs: ms },
          workspace: { name: "drime_admin", id: 1, exists: true },
        }),
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
      expect(screen.getByText(`${ms} ms`)).toHaveClass(expectedClass);
    });
  });
});
