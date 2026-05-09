import { describe, expect, test } from "bun:test";
import pino from "pino";
import { dispatchAdmin } from "../../src/admin/router";
import type { AppContext } from "../../src/server-context";
import { createAppContext } from "../../src/server-context";
import { adminTestConfig } from "./helpers";
import { startMockDrime } from "../fixtures/mock-drime/server";

async function ctxWith(password: string): Promise<{ ctx: AppContext; stop: () => void }> {
  const mock = await startMockDrime();
  const cfg = adminTestConfig(mock.baseUrl, { password });
  const ctx = await createAppContext({ config: cfg, logger: pino({ level: "silent" }) });
  return { ctx, stop: () => mock.stop() };
}

describe("admin router scaffold", () => {
  test("returns 503 AdminDisabled when WEB_UI_PASSWORD unset (except /health)", async () => {
    const { ctx, stop } = await ctxWith("");
    try {
      const url = new URL("http://127.0.0.1:8081/_admin/session");
      const res = await dispatchAdmin(ctx, new Request(url), url);
      expect(res.status).toBe(503);
      const j = await res.json() as { error: { code: string } };
      expect(j.error.code).toBe("AdminDisabled");
    } finally {
      stop();
    }
  });

  test("returns 404 NotFound for unknown admin path when enabled", async () => {
    const { ctx, stop } = await ctxWith("hunter2-hunter2");
    try {
      const url = new URL("http://127.0.0.1:8081/_admin/no-such-thing");
      const res = await dispatchAdmin(ctx, new Request(url), url);
      expect(res.status).toBe(404);
      const j = await res.json() as { error: { code: string } };
      expect(j.error.code).toBe("NotFound");
    } finally {
      stop();
    }
  });
});
