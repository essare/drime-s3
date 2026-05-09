import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("GET /_admin/status", () => {
  test("happy path reports env present, drime reachable, workspace exists", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["my-bucket"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/status`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as {
        env: Record<string, unknown>;
        drime: { reachable: boolean; latencyMs: number };
        workspace: { name: string; id: number | null; exists: boolean };
      };
      expect(j.env.drimeApiKeySet).toBe(true);
      expect(j.env.s3KeysSet).toBe(true);
      expect(j.drime.reachable).toBe(true);
      expect(j.drime.latencyMs).toBeGreaterThanOrEqual(0);
      expect(j.workspace.exists).toBe(true);
      expect(j.workspace.name).toBe("drime-s3");
      expect(typeof j.workspace.id).toBe("number");
    } finally {
      setup.cleanup();
    }
  });

  test("workspace.exists=false when configured workspace name doesn't exist", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      gatewayWorkspaceName: "missing-workspace-xyz",
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/status`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { workspace: { exists: boolean; id: number | null } };
      expect(j.workspace.exists).toBe(false);
      expect(j.workspace.id).toBeNull();
    } finally {
      setup.cleanup();
    }
  });

  test("requires session cookie", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(
        new Request(`${ORIG}/_admin/status`, {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(401);
    } finally {
      setup.cleanup();
    }
  });
});
