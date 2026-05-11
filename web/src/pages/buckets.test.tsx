import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createTestQueryClient,
  mockFetchByUrl,
  renderWithProviders,
} from "@/test/utils";
import BucketsPage from "./buckets";

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

describe("BucketsPage", () => {
  it("renders bucket grid with links to detail pages", async () => {
    mockFetchByUrl({
      "/_admin/buckets": () =>
        jsonResponse({
          count: 2,
          buckets: [
            { name: "alpha", createdAt: "2026-05-09T10:00:00.000Z" },
            { name: "beta", createdAt: "2026-05-08T10:00:00.000Z" },
          ],
        }),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/buckets"]}>
        <BucketsPage />
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(
        screen.getByText("2 buckets in this workspace"),
      ).toBeInTheDocument();
    });

    const alpha = screen.getByRole("link", { name: /alpha/i });
    const beta = screen.getByRole("link", { name: /beta/i });
    expect(alpha).toHaveAttribute("href", "/buckets/alpha");
    expect(beta).toHaveAttribute("href", "/buckets/beta");
  });

  it("uses singular wording for one bucket", async () => {
    mockFetchByUrl({
      "/_admin/buckets": () =>
        jsonResponse({
          count: 1,
          buckets: [{ name: "only", createdAt: "2026-05-09T10:00:00.000Z" }],
        }),
    });
    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/buckets"]}>
        <BucketsPage />
      </MemoryRouter>,
      client,
    );
    await waitFor(() => {
      expect(
        screen.getByText("1 bucket in this workspace"),
      ).toBeInTheDocument();
    });
  });

  it("shows empty state CTA when there are no buckets", async () => {
    mockFetchByUrl({
      "/_admin/buckets": () => jsonResponse({ count: 0, buckets: [] }),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/buckets"]}>
        <BucketsPage />
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("No buckets yet")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Create your first bucket" }),
    ).toBeInTheDocument();
  });

  it("shows skeleton placeholders while buckets are loading", async () => {
    mockFetchByUrl({
      "/_admin/buckets": () => new Promise<Response>(() => {}),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/buckets"]}>
        <BucketsPage />
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("bucket-skeleton").length).toBeGreaterThan(
        0,
      );
    });
  });
});
