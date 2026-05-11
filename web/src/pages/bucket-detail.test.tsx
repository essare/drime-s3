import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createTestQueryClient,
  mockFetchByUrl,
  renderWithProviders,
} from "@/test/utils";
import BucketDetailPage from "./bucket-detail";

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

function SearchParamsProbe() {
  const [sp] = useSearchParams();
  return <span data-testid="search-params">{sp.toString()}</span>;
}

describe("BucketDetailPage", () => {
  it("updates URL search params to the new folder prefix after successful create", async () => {
    mockFetchByUrl({
      "/_admin/buckets/mybucket/objects": () =>
        jsonResponse({
          prefix: "",
          delimiter: "/",
          objects: [],
          commonPrefixes: [],
          nextToken: null,
        }),
      "/_admin/buckets/mybucket/folders": () =>
        jsonResponse({ name: "photos", prefix: "photos/" }, 201),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/buckets/mybucket"]}>
        <SearchParamsProbe />
        <Routes>
          <Route path="/buckets/:bucket" element={<BucketDetailPage />} />
        </Routes>
      </MemoryRouter>,
      client,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /new folder/i }),
    );
    await userEvent.type(screen.getByLabelText(/folder name/i), "photos");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      const raw = screen.getByTestId("search-params").textContent ?? "";
      expect(new URLSearchParams(raw).get("prefix")).toBe("photos/");
    });
  });

  it("renders a New folder button that opens the create-folder dialog", async () => {
    mockFetchByUrl({
      "/_admin/buckets/docs/objects": () =>
        jsonResponse({
          prefix: "",
          delimiter: "/",
          objects: [],
          commonPrefixes: [],
          nextToken: null,
        }),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/buckets/docs"]}>
        <Routes>
          <Route path="/buckets/:bucket" element={<BucketDetailPage />} />
        </Routes>
      </MemoryRouter>,
      client,
    );

    const btn = await screen.findByRole("button", { name: /new folder/i });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(
      await screen.findByRole("dialog", { name: /create folder/i }),
    ).toBeInTheDocument();
  });

  it("shows New folder and opens the dialog when the page has a non-empty prefix", async () => {
    mockFetchByUrl({
      "/_admin/buckets/mybucket/objects": () =>
        jsonResponse({
          prefix: "docs/",
          delimiter: "/",
          objects: [],
          commonPrefixes: [],
          nextToken: null,
        }),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/buckets/mybucket?prefix=docs%2F"]}>
        <Routes>
          <Route path="/buckets/:bucket" element={<BucketDetailPage />} />
        </Routes>
      </MemoryRouter>,
      client,
    );

    const btn = await screen.findByRole("button", { name: /new folder/i });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(
      await screen.findByRole("dialog", { name: /create folder/i }),
    ).toBeInTheDocument();
  });
});
