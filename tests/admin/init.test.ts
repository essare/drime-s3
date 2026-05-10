import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("POST /_admin/init", () => {
  test("creates the workspace and returns its id", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      gatewayWorkspaceName: "fresh-workspace",
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/init`, {
          method: "POST",
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { workspaceId: number };
      expect(typeof j.workspaceId).toBe("number");
      expect(j.workspaceId).toBeGreaterThan(0);
      expect(setup.ctx.gatewayWorkspaceId).toBe(j.workspaceId);
    } finally {
      setup.cleanup();
    }
  });

  test("idempotent: second call returns the same id", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const headers = { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG };
      const a = await setup.call(
        new Request(`${ORIG}/_admin/init`, { method: "POST", headers }),
      );
      const b = await setup.call(
        new Request(`${ORIG}/_admin/init`, { method: "POST", headers }),
      );
      const ja = (await a.json()) as { workspaceId: number };
      const jb = (await b.json()) as { workspaceId: number };
      expect(ja.workspaceId).toBe(jb.workspaceId);
    } finally {
      setup.cleanup();
    }
  });
});
