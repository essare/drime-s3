import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestQueryClient } from "@/test/utils";

import { useDeleteObject } from "./use-delete-object";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";

let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
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

describe("useDeleteObject", () => {
  it("issues DELETE with per-segment encoded object path", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.href;
        const path = new URL(url, "http://localhost").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        expect(path).toBe("/_admin/buckets/alpha/objects/a/b%20c.txt");
        expect(method).toBe("DELETE");
        return new Response(null, { status: 204 });
      },
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const client = createTestQueryClient();
    const { result } = renderHook(() => useDeleteObject(), {
      wrapper: wrapperFor(client),
    });

    result.current.mutate({ bucket: "alpha", key: "a/b c.txt" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("invalidates object listing queries for the bucket on success", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useDeleteObject(), {
      wrapper: wrapperFor(client),
    });

    result.current.mutate({ bucket: "alpha", key: "x.txt" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["admin", "objects", "alpha"],
    });
  });

  it("shows error toast on API failure", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "InternalError", message: "boom" },
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

    const client = createTestQueryClient();
    const { result } = renderHook(() => useDeleteObject(), {
      wrapper: wrapperFor(client),
    });

    result.current.mutate({ bucket: "alpha", key: "x.txt" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toast.error).toHaveBeenCalledWith("boom");
  });
});
