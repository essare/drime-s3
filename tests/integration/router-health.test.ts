import { describe, expect, test } from "bun:test";
import pino from "pino";
import type { AppConfig } from "../../src/config";
import { dispatch } from "../../src/s3/router";
import { createAppContext } from "../../src/server-context";
import { startMockDrime } from "../fixtures/mock-drime/server";

function testConfig(apiBaseUrl: string): AppConfig {
  return {
    s3: {
      accessKey: "AKIATEST",
      secretKey: "test-secret-test-secret-test-secret",
      region: "drime",
    },
    drime: {
      apiKey: "mock-drime-key",
      apiBaseUrl,
      gatewayWorkspaceName: "drime-s3",
    },
    server: { host: "127.0.0.1", port: 8081 },
    webUi: { password: "", sessionSecret: "" },
    insecure: true,
  };
}

describe("S3 router", () => {
  test("GET / returns ListAllMyBuckets XML when workspace resolves", async () => {
    const mock = await startMockDrime({
      seedRootFolders: ["my-test-bucket"],
    });
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      expect(ctx.gatewayWorkspaceId).toBe(1);

      const req = new Request("http://127.0.0.1:8081/", {
        method: "GET",
        headers: { Host: "127.0.0.1:8081" },
      });
      const res = await dispatch(ctx, req);
      expect(res.status).toBe(200);
      const xml = await res.text();
      expect(xml).toContain("ListAllMyBucketsResult");
      expect(xml).toContain("my-test-bucket");
    } finally {
      mock.stop();
    }
  });

  test("GET /_health returns cache sizes on localhost host", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const req = new Request("http://127.0.0.1:8081/_health", {
        headers: { Host: "localhost:8081" },
      });
      const res = await dispatch(ctx, req);
      expect(res.status).toBe(200);
      const j = (await res.json()) as Record<string, unknown>;
      expect(typeof j.folderPathCache).toBe("number");
      expect(typeof j.listTtlCache).toBe("number");
      expect(typeof j.multipartSessions).toBe("number");
      expect(j.webUi).toBeDefined();
      const w = j.webUi as { passwordSet: boolean; activeSessions: number };
      expect(typeof w.passwordSet).toBe("boolean");
      expect(typeof w.activeSessions).toBe("number");
    } finally {
      mock.stop();
    }
  });

  test("OPTIONS /bucket returns CORS preflight (204)", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const req = new Request("http://127.0.0.1:8081/some-bucket/object", {
        method: "OPTIONS",
        headers: { Host: "127.0.0.1:8081" },
      });
      const res = await dispatch(ctx, req);
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    } finally {
      mock.stop();
    }
  });
});
