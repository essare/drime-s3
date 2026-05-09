import { describe, expect, test } from "bun:test";
import { startAdmin } from "./helpers";

describe("GET /_admin/health", () => {
  test("returns ok=true and hasPassword=true when password set", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/health", {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { ok: boolean; version: string; hasPassword: boolean };
      expect(j.ok).toBe(true);
      expect(j.hasPassword).toBe(true);
      expect(typeof j.version).toBe("string");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      setup.cleanup();
    }
  });

  test("returns hasPassword=false when WEB_UI_PASSWORD unset", async () => {
    const setup = await startAdmin({ password: "" });
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/health", {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { hasPassword: boolean }).hasPassword).toBe(false);
    } finally {
      setup.cleanup();
    }
  });
});
