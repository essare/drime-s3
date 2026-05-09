import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AdminApiError,
  adminFetchEmpty,
  adminFetchJson,
  registerUnauthorizedHandler,
  resetUnauthorizedHandler,
} from "./api";

function mockFetch(
  handler: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>,
): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(input, init),
  ) as unknown as typeof fetch;
}

let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  resetUnauthorizedHandler();
  globalThis.fetch = originalFetch;
});

describe("adminFetchJson", () => {
  it("happy 200 + schema parse", async () => {
    mockFetch(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const schema = z.object({ ok: z.boolean() });
    const result = await adminFetchJson("/x", { schema });
    expect(result).toEqual({ ok: true });
  });

  it("schema mismatch on 200 rejects (ZodError)", async () => {
    mockFetch(
      async () => new Response(JSON.stringify({ ok: "yes" }), { status: 200 }),
    );

    const schema = z.object({ ok: z.boolean() });
    await expect(adminFetchJson("/x", { schema })).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("401 with valid envelope triggers onUnauthorized and throws AdminApiError", async () => {
    const spy = vi.fn();
    registerUnauthorizedHandler(spy);

    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "Unauthorized", message: "nope" } }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );

    await expect(
      adminFetchJson("/_admin/session", {
        method: "GET",
        schema: z.object({}),
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: "Unauthorized",
      message: "nope",
    });

    expect(spy).toHaveBeenCalledOnce();
  });

  it("401 without body yields UnknownError and still triggers onUnauthorized", async () => {
    const spy = vi.fn();
    registerUnauthorizedHandler(spy);

    mockFetch(async () => new Response("", { status: 401 }));

    try {
      await adminFetchJson("/x", { schema: z.object({ ok: z.boolean() }) });
      expect.fail("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(AdminApiError);
      expect(e).toMatchObject({ status: 401, code: "UnknownError" });
    }

    expect(spy).toHaveBeenCalledOnce();
  });

  it("500 with malformed body throws UnknownError whose message contains boom", async () => {
    mockFetch(
      async () =>
        new Response("boom", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
    );

    try {
      await adminFetchJson("/x", { schema: z.object({ ok: z.boolean() }) });
      expect.fail("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(AdminApiError);
      expect(e).toMatchObject({ status: 500, code: "UnknownError" });
      expect((e as AdminApiError).message).toContain("boom");
    }
  });

  it("sets Origin header to window.location.origin when not provided", async () => {
    mockFetch(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Origin")).toBe(window.location.origin);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const schema = z.object({ ok: z.boolean() });
    await adminFetchJson("/x", { schema });
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("serializes object body as JSON and sets Content-Type", async () => {
    mockFetch(async (_input, init) => {
      expect(init?.body).toBe('{"name":"foo"}');
      const headers = new Headers(init?.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const schema = z.object({ ok: z.boolean() });
    await adminFetchJson("/x", {
      method: "POST",
      body: { name: "foo" },
      schema,
    });
  });

  it("passes string body through and does not set JSON Content-Type", async () => {
    mockFetch(async (_input, init) => {
      expect(init?.body).toBe("plain-text");
      const headers = new Headers(init?.headers);
      expect(headers.get("Content-Type")).not.toBe("application/json");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const schema = z.object({ ok: z.boolean() });
    await adminFetchJson("/x", {
      method: "POST",
      body: "plain-text",
      schema,
    });
  });
});

describe("adminFetchEmpty", () => {
  it("happy path 204 resolves with undefined", async () => {
    mockFetch(async () => new Response(null, { status: 204 }));

    const result = await adminFetchEmpty("/logout");
    expect(result).toBeUndefined();
  });

  it("409 with envelope rejects with AdminApiError", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "Conflict", message: "exists" } }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );

    await expect(adminFetchEmpty("/x")).rejects.toMatchObject({
      status: 409,
      code: "Conflict",
      message: "exists",
    });
  });
});
