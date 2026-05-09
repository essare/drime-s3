import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminApiError } from "@/lib/api";
import { createTestQueryClient } from "@/test/utils";

import { flattenListings, useObjectsQuery } from "./use-objects";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useObjectsQuery", () => {
  it("flattens a single page with folders first", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.href;
      expect(new URL(url, "http://localhost").pathname).toBe(
        "/_admin/buckets/acme/objects",
      );

      return Response.json({
        prefix: "",
        delimiter: "/",
        objects: [
          {
            key: "a.txt",
            size: 1,
            lastModified: "2026-01-01T00:00:00.000Z",
            etag: "e1",
          },
          {
            key: "b.txt",
            size: 2,
            lastModified: "2026-01-02T00:00:00.000Z",
            etag: "e2",
          },
          {
            key: "c.txt",
            size: 3,
            lastModified: "2026-01-03T00:00:00.000Z",
            etag: "e3",
          },
        ],
        commonPrefixes: ["docs/"],
        nextToken: null,
      });
    }) as unknown as typeof fetch;

    const client = createTestQueryClient();
    const { result } = renderHook(
      () => useObjectsQuery({ bucket: "acme", prefix: "" }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rows = flattenListings(result.current.data?.pages);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ kind: "folder", name: "docs" });
    expect(rows.slice(1).every((r) => r.kind === "object")).toBe(true);
  });

  it("requests the next page with the previous token", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.href;
      const token = new URL(url, "http://localhost").searchParams.get("token");

      if (!token) {
        return Response.json({
          prefix: "",
          delimiter: "/",
          objects: [
            {
              key: "p1.txt",
              size: 1,
              lastModified: "2026-01-01T00:00:00.000Z",
              etag: "e1",
            },
          ],
          commonPrefixes: [],
          nextToken: "abc",
        });
      }

      if (token === "abc") {
        return Response.json({
          prefix: "",
          delimiter: "/",
          objects: [
            {
              key: "p2.txt",
              size: 2,
              lastModified: "2026-01-02T00:00:00.000Z",
              etag: "e2",
            },
          ],
          commonPrefixes: ["sub/"],
          nextToken: null,
        });
      }

      throw new Error(`unexpected token: ${token}`);
    }) as unknown as typeof fetch;

    const client = createTestQueryClient();
    const { result } = renderHook(
      () => useObjectsQuery({ bucket: "paginated", prefix: "" }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);

    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    const rows = flattenListings(result.current.data?.pages);
    expect(rows).toHaveLength(3);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondInput = fetchMock.mock.calls[1]?.[0] as string;
    expect(String(secondInput)).toContain("token=abc");
  });

  it("surfaces NoSuchBucket as AdminApiError", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: { code: "NoSuchBucket", message: "missing bucket" },
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const client = createTestQueryClient();
    const { result } = renderHook(
      () => useObjectsQuery({ bucket: "missing", prefix: "" }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(AdminApiError);
    expect((result.current.error as AdminApiError).code).toBe("NoSuchBucket");
  });
});
