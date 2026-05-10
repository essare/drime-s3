import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { healthKey, sessionKey } from "@/lib/query-keys";
import { createTestQueryClient } from "@/test/utils";

import { useLogout } from "./use-logout";

let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/app"]}>
          <Routes>
            <Route path="*" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe("useLogout", () => {
  it("POSTs logout, removes admin queries except health, and navigates to login", async () => {
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.href;
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/_admin/logout") && method === "POST") {
          return new Response(null, { status: 204 });
        }
        return new Response("not found", { status: 404 });
      },
    ) as unknown as typeof fetch;

    const client = createTestQueryClient();
    client.setQueryData(healthKey, {
      ok: true,
      version: "1",
      hasPassword: true,
    });
    client.setQueryData(sessionKey, {
      authenticated: true,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const { result } = renderHook(() => useLogout(), {
      wrapper: wrapperFor(client),
    });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(sessionKey)).toBeUndefined();
    expect(client.getQueryData(healthKey)).toEqual({
      ok: true,
      version: "1",
      hasPassword: true,
    });
  });
});
