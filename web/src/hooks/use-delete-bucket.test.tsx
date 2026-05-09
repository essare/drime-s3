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

import { bucketsKey } from "@/lib/query-keys";
import { createTestQueryClient } from "@/test/utils";

import { useDeleteBucket } from "./use-delete-bucket";

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

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useDeleteBucket", () => {
  it("invalidates buckets and toasts success on 204", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.href;
        const path = new URL(url, "http://localhost").pathname;
        expect(path).toBe("/_admin/buckets/acme");
        expect((init?.method ?? "GET").toUpperCase()).toBe("DELETE");
        return new Response(null, { status: 204 });
      },
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useDeleteBucket(), {
      wrapper: wrapperFor(client),
    });

    result.current.mutate({ name: "acme" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bucketsKey });
    expect(toast.success).toHaveBeenCalledWith(`Bucket "acme" deleted`);
  });

  it("toasts not empty on 409 BucketNotEmpty without invalidating buckets", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonError(
        "BucketNotEmpty",
        "The bucket you tried to delete is not empty",
        409,
      ),
    ) as unknown as typeof fetch;

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useDeleteBucket(), {
      wrapper: wrapperFor(client),
    });

    result.current.mutate({ name: "full-bucket" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toast.error).toHaveBeenCalledWith(
      `Bucket "full-bucket" is not empty`,
      expect.objectContaining({
        description: "Delete its objects first, then retry.",
      }),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: bucketsKey,
    });
  });

  it("toasts missing bucket and invalidates on 404 NoSuchBucket", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonError("NoSuchBucket", "gone", 404),
    ) as unknown as typeof fetch;

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useDeleteBucket(), {
      wrapper: wrapperFor(client),
    });

    result.current.mutate({ name: "ghost" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toast.error).toHaveBeenCalledWith("Bucket no longer exists");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bucketsKey });
  });
});
