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

  test("DELETE non-empty bucket returns 409 BucketNotEmpty; empty returns 204", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const bucket = "delete-bucket";
      const objectKey = "object.txt";
      const h = { Host: "127.0.0.1:8081" };

      let res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "PUT", headers: h }),
      );
      expect(res.status).toBe(200);

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "PUT",
          headers: {
            ...h,
            "Content-Type": "text/plain",
            "Content-Length": "6",
          },
          body: "stored",
        }),
      );
      expect(res.status).toBe(200);

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "DELETE", headers: h }),
      );
      expect(res.status).toBe(409);
      expect(await res.text()).toContain("BucketNotEmpty");

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "DELETE",
          headers: h,
        }),
      );
      expect(res.status).toBe(204);

      const originalListFolder = ctx.drime.listFolder.bind(ctx.drime);
      const rootEntries = await originalListFolder(null, 1);
      const bucketFolder = rootEntries.find((entry) => entry.name === bucket);
      expect(bucketFolder).toBeDefined();
      ctx.drime.listFolder = async (parentId, workspaceId) => {
        const entries = await originalListFolder(parentId, workspaceId);
        return parentId === bucketFolder?.id
          ? [...entries, bucketFolder]
          : entries;
      };

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "DELETE", headers: h }),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("content-length")).toBe("0");

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "HEAD", headers: h }),
      );
      expect(res.status).toBe(404);
    } finally {
      mock.stop();
    }
  });

  test("DELETE bucket succeeds when only empty prefix folders remain after object delete", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const bucket = "prefix-bucket";
      const objectKey = "ladder/nested/object.txt";
      const h = { Host: "127.0.0.1:8081" };

      let res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "PUT", headers: h }),
      );
      expect(res.status).toBe(200);

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "PUT",
          headers: {
            ...h,
            "Content-Type": "text/plain",
            "Content-Length": "6",
          },
          body: "stored",
        }),
      );
      expect(res.status).toBe(200);

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "DELETE",
          headers: h,
        }),
      );
      expect(res.status).toBe(204);

      // Recursive list looks empty, but Drime still has empty prefix folders.
      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}?list-type=2`, {
          method: "GET",
          headers: h,
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<KeyCount>0</KeyCount>");

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "DELETE", headers: h }),
      );
      expect(res.status).toBe(204);

      res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "HEAD", headers: h }),
      );
      expect(res.status).toBe(404);
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
