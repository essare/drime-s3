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

describe("Object CRUD", () => {
  test("PUT HEAD GET Range DELETE", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const h = { Host: "127.0.0.1:8081" };
      const bucket = "obj-crud-bucket";
      const objectKey = "greeting.txt";
      const payload = "hello";

      const mk = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "PUT", headers: h }),
      );
      expect(mk.status).toBe(200);

      const put = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "PUT",
          headers: {
            ...h,
            "Content-Type": "application/octet-stream",
            "Content-Length": String(Buffer.byteLength(payload, "utf8")),
          },
          body: payload,
        }),
      );
      expect(put.status).toBe(200);
      const putEtag = put.headers.get("etag");
      expect(putEtag).toBe('"5d41402abc4b2a76b9719d911017c592"');

      const head = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "HEAD",
          headers: h,
        }),
      );
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe("5");
      expect(head.headers.get("etag")).toBe(putEtag);

      const full = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "GET",
          headers: h,
        }),
      );
      expect(full.status).toBe(200);
      expect(await full.text()).toBe(payload);

      const partial = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "GET",
          headers: { ...h, Range: "bytes=1-3" },
        }),
      );
      expect(partial.status).toBe(206);
      expect(partial.headers.get("content-range")).toBe("bytes 1-3/5");
      expect(await partial.text()).toBe("ell");

      const del = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "DELETE",
          headers: h,
        }),
      );
      expect(del.status).toBe(204);

      const gone = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "GET",
          headers: h,
        }),
      );
      expect(gone.status).toBe(404);

      const delMissing = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "DELETE",
          headers: h,
        }),
      );
      expect(delMissing.status).toBe(204);
    } finally {
      mock.stop();
    }
  });
});
