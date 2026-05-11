import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/api";
import { useCreateFolder } from "./use-create-folder";

function wrapper(client: QueryClient) {
  return function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useCreateFolder", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the right URL with prefix omitted when empty and invalidates objectsKey", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "reports", prefix: "reports/" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        bucket: "docs",
        prefix: "",
        name: "reports",
      });
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const first = fetchMock.mock.calls[0];
    expect(first).toBeDefined();
    const [url, init] = first as [Parameters<typeof fetch>[0], RequestInit];
    expect(String(url)).toBe("/_admin/buckets/docs/folders");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ path: "reports" }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["admin", "objects", "docs", { prefix: "", delimiter: "/" }],
      }),
    );
  });

  it("attaches ?prefix=<p> when prefix is non-empty", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "q1", prefix: "reports/q1/" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        bucket: "docs",
        prefix: "reports/",
        name: "q1",
      });
    });
    const second = fetchMock.mock.calls[0];
    expect(second).toBeDefined();
    const [url] = second as [Parameters<typeof fetch>[0], RequestInit];
    expect(String(url)).toBe("/_admin/buckets/docs/folders?prefix=reports");
  });

  it.each([
    { existingKind: "folder" as const },
    { existingKind: "file" as const },
  ])("surfaces 409 FolderAlreadyExists with existingKind $existingKind", async ({
    existingKind,
  }) => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "FolderAlreadyExists",
            message: "conflict",
            details: { existingKind },
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapper(client),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          bucket: "docs",
          prefix: "",
          name: "dup",
        });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(AdminApiError);
    const err = caught as AdminApiError;
    expect(err.code).toBe("FolderAlreadyExists");
    expect(
      (err.details as { existingKind?: string } | undefined)?.existingKind,
    ).toBe(existingKind);
  });

  it("surfaces 400 BadRequest with message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "BadRequest",
            message: "Invalid folder path",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapper(client),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          bucket: "docs",
          prefix: "",
          name: "x",
        });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(AdminApiError);
    const err = caught as AdminApiError;
    expect(err.code).toBe("BadRequest");
    expect(err.message).toBe("Invalid folder path");
  });

  it("surfaces 5xx response message in AdminApiError", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "InternalError",
            message: "upstream timeout",
          },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapper(client),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          bucket: "docs",
          prefix: "",
          name: "x",
        });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(AdminApiError);
    expect((caught as AdminApiError).message).toBe("upstream timeout");
  });

  it("rejects with preserved message when fetch fails at the network layer", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapper(client),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          bucket: "docs",
          prefix: "",
          name: "x",
        });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("network down");
  });
});
