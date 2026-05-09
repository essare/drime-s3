import { describe, expect, test } from "bun:test";
import { jsonError, jsonOk, jsonStream } from "../../src/admin/errors";

describe("admin/errors", () => {
  test("jsonError returns the documented envelope", async () => {
    const r = jsonError("Unauthorized", "bad password", 401);
    expect(r.status).toBe(401);
    expect(r.headers.get("Content-Type")).toBe("application/json");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const j = await r.json();
    expect(j).toEqual({ error: { code: "Unauthorized", message: "bad password" } });
  });

  test("jsonError includes details when provided", async () => {
    const r = jsonError("RateLimited", "slow down", 429, { retryAfter: 30 });
    expect((await r.json()).error.details).toEqual({ retryAfter: 30 });
  });

  test("jsonError merges extraHeaders but always enforces Content-Type and Cache-Control", async () => {
    const r = jsonError("RateLimited", "slow down", 429, { retryAfter: 30 }, {
      "Retry-After": "30",
      "Content-Type": "text/plain",
      "Cache-Control": "max-age=3600",
    });
    expect(r.headers.get("Retry-After")).toBe("30");
    expect(r.headers.get("Content-Type")).toBe("application/json");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });

  test("jsonOk returns 200 with payload + no-store", async () => {
    const r = jsonOk({ ok: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });

  test("jsonOk applies custom status code", () => {
    const r = jsonOk({}, 204);
    expect(r.status).toBe(204);
  });

  test("jsonStream attaches no-store and given content-type", async () => {
    const r = jsonStream(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1,2])); c.close(); } }), {
      contentType: "application/octet-stream",
      contentLength: 2,
    });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(r.headers.get("Content-Length")).toBe("2");
    const buf = await r.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2]));
  });

  test("jsonStream omits Content-Length when not provided and merges extraHeaders", () => {
    const r = jsonStream("hello", {
      contentType: "text/plain",
      extraHeaders: { "Content-Disposition": 'attachment; filename="x"' },
    });
    expect(r.headers.get("Content-Length")).toBeNull();
    expect(r.headers.get("Content-Type")).toBe("text/plain");
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="x"');
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
});
