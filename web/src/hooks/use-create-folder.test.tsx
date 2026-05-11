import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
