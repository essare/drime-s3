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

import { useBatchDeleteObjects } from "./use-batch-delete";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
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
  vi.mocked(toast.warning).mockClear();
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

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useBatchDeleteObjects", () => {
  it("POSTs batchDelete with encoded bucket and keys JSON body", async () => {
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
        if (
          path === "/_admin/buckets/alpha/objects:batchDelete" &&
          method === "POST"
        ) {
          expect(init?.body).toBe('{"keys":["a/b.txt","c.txt"]}');
          return jsonResponse({ deleted: ["a/b.txt", "c.txt"], errors: [] });
        }
        return new Response("not found", { status: 404 });
      },
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const client = createTestQueryClient();
    const { result } = renderHook(() => useBatchDeleteObjects(), {
      wrapper: wrapperFor(client),
    });

    result.current.mutate({
      bucket: "alpha",
      keys: ["a/b.txt", "c.txt"],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("toasts success and invalidates objects queries when all keys deleted", async () => {
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.href;
        const path = new URL(url, "http://localhost").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        if (
          path === "/_admin/buckets/alpha/objects:batchDelete" &&
          method === "POST"
        ) {
          return jsonResponse({ deleted: ["a/b.txt", "c.txt"], errors: [] });
        }
        return new Response("not found", { status: 404 });
      },
    ) as unknown as typeof fetch;

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useBatchDeleteObjects(), {
      wrapper: wrapperFor(client),
    });

    result.current.mutate({ bucket: "alpha", keys: ["a/b.txt", "c.txt"] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(toast.success).toHaveBeenCalled();
    const msg = vi.mocked(toast.success).mock.calls[0]?.[0] as string;
    expect(msg).toContain("Deleted 2 objects");

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["admin", "objects", "alpha"],
    });
  });

  it("toasts warning when some keys fail", async () => {
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.href;
        const path = new URL(url, "http://localhost").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        if (
          path === "/_admin/buckets/alpha/objects:batchDelete" &&
          method === "POST"
        ) {
          return jsonResponse({
            deleted: ["a"],
            errors: [
              {
                key: "b",
                code: "AccessDenied",
                message: "nope",
              },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      },
    ) as unknown as typeof fetch;

    const client = createTestQueryClient();
    const { result } = renderHook(() => useBatchDeleteObjects(), {
      wrapper: wrapperFor(client),
    });

    result.current.mutate({ bucket: "alpha", keys: ["a", "b"] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(toast.warning).toHaveBeenCalled();
    const msg = vi.mocked(toast.warning).mock.calls[0]?.[0] as string;
    expect(msg).toMatch(/Deleted 1/);
    expect(msg).toMatch(/1 failed/);
    expect(msg).toContain("b");
  });
});
