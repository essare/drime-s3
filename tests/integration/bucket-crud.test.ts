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
    insecure: true,
  };
}

describe("bucket CRUD", () => {
  test("PUT creates root folder; DELETE removes empty bucket; HEAD 404 then 200", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });

      const base = "http://127.0.0.1:8081";
      const bucket = "newbucket";

      let res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, {
          method: "HEAD",
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(404);

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, {
          method: "PUT",
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(200);

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, {
          method: "HEAD",
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(200);

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, {
          method: "DELETE",
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(204);

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, {
          method: "HEAD",
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(404);
    } finally {
      mock.stop();
    }
  });

  test("second PUT to same bucket returns 409", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const url = "http://127.0.0.1:8081/dup-bucket";
      const h = { Host: "127.0.0.1:8081" };
      let res = await dispatch(
        ctx,
        new Request(url, { method: "PUT", headers: h }),
      );
      expect(res.status).toBe(200);
      res = await dispatch(
        ctx,
        new Request(url, { method: "PUT", headers: h }),
      );
      expect(res.status).toBe(409);
    } finally {
      mock.stop();
    }
  });

  test("GET ?location returns LocationConstraint", async () => {
    const mock = await startMockDrime({ seedRootFolders: ["loc-bucket"] });
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const res = await dispatch(
        ctx,
        new Request("http://127.0.0.1:8081/loc-bucket?location", {
          method: "GET",
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(200);
      const xml = await res.text();
      expect(xml).toContain("LocationConstraint");
      expect(xml).toContain("drime");
    } finally {
      mock.stop();
    }
  });
});
