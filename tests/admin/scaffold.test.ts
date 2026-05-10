import { describe, expect, test } from "bun:test";
import pino from "pino";
import { dispatchAdmin } from "../../src/admin/router";
import type { AppContext } from "../../src/server-context";
import { createAppContext } from "../../src/server-context";
import { startMockDrime } from "../fixtures/mock-drime/server";
import { adminTestConfig } from "./helpers";

async function ctxWith(
  password: string,
): Promise<{ ctx: AppContext; stop: () => void }> {
  const mock = await startMockDrime();
  const cfg = adminTestConfig(mock.baseUrl, { password });
  const ctx = await createAppContext({
    config: cfg,
    logger: pino({ level: "silent" }),
  });
  return { ctx, stop: () => mock.stop() };
}

describe("admin router scaffold", () => {
  test("returns 503 AdminDisabled when WEB_UI_PASSWORD unset (except /health)", async () => {
    const { ctx, stop } = await ctxWith("");
    try {
      const url = new URL("http://127.0.0.1:8081/_admin/session");
      const res = await dispatchAdmin(ctx, new Request(url), url);
      expect(res.status).toBe(503);
      const j = (await res.json()) as { error: { code: string } };
      expect(j.error.code).toBe("AdminDisabled");
    } finally {
      stop();
    }
  });

  test("returns 401 for unknown admin path when enabled but not logged in", async () => {
    const { ctx, stop } = await ctxWith("hunter2-hunter2");
    try {
      const url = new URL("http://127.0.0.1:8081/_admin/no-such-thing");
      const res = await dispatchAdmin(ctx, new Request(url), url);
      expect(res.status).toBe(401);
      const j = (await res.json()) as { error: { code: string } };
      expect(j.error.code).toBe("Unauthorized");
    } finally {
      stop();
    }
  });

  test("returns 404 NotFound for unknown admin path after login", async () => {
    const { ctx, stop } = await ctxWith("hunter2-hunter2");
    try {
      const loginUrl = new URL("http://127.0.0.1:8081/_admin/login");
      const loginRes = await dispatchAdmin(
        ctx,
        new Request(loginUrl, {
          method: "POST",
          headers: {
            Host: "127.0.0.1:8081",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password: "hunter2-hunter2" }),
        }),
        loginUrl,
      );
      expect(loginRes.status).toBe(200);
      const setCookie = loginRes.headers.get("set-cookie");
      if (!setCookie) throw new Error("expected Set-Cookie");
      const semi = setCookie.indexOf(";");
      const cookie = semi === -1 ? setCookie : setCookie.slice(0, semi);

      const url = new URL("http://127.0.0.1:8081/_admin/no-such-thing");
      const res = await dispatchAdmin(
        ctx,
        new Request(url, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie },
        }),
        url,
      );
      expect(res.status).toBe(404);
      const j = (await res.json()) as { error: { code: string } };
      expect(j.error.code).toBe("NotFound");
    } finally {
      stop();
    }
  });
});
