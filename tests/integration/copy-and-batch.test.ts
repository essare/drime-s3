import { describe, expect, test } from "bun:test";
import { XMLParser } from "fast-xml-parser";
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

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

describe("CopyObject and batch delete", () => {
  test("CopyObject then GET destination matches source", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const h = { Host: "127.0.0.1:8081" };
      const bucket = "copy-batch-bucket";
      const body = "copy-payload-xyz";

      await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "PUT", headers: h }),
      );

      await dispatch(
        ctx,
        new Request(`${base}/${bucket}/a.txt`, {
          method: "PUT",
          headers: {
            ...h,
            "Content-Type": "application/octet-stream",
            "Content-Length": String(Buffer.byteLength(body, "utf8")),
          },
          body,
        }),
      );

      const srcPath = `/${bucket}/a.txt`;
      const copy = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/b.txt`, {
          method: "PUT",
          headers: {
            ...h,
            "x-amz-copy-source": encodeURIComponent(srcPath),
          },
        }),
      );
      expect(copy.status).toBe(200);
      const copyXml = await copy.text();
      expect(copyXml).toContain("CopyObjectResult");

      const getB = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/b.txt`, { method: "GET", headers: h }),
      );
      expect(getB.status).toBe(200);
      expect(await getB.text()).toBe(body);
    } finally {
      mock.stop();
    }
  });

  test("DeleteObjects removes two keys", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const h = { Host: "127.0.0.1:8081" };
      const bucket = "batch-del-bucket";

      await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "PUT", headers: h }),
      );

      for (const k of ["o1.txt", "o2.txt"]) {
        await dispatch(
          ctx,
          new Request(`${base}/${bucket}/${k}`, {
            method: "PUT",
            headers: {
              ...h,
              "Content-Type": "application/octet-stream",
              "Content-Length": "1",
            },
            body: "x",
          }),
        );
      }

      const deleteBody = `<?xml version="1.0" encoding="UTF-8"?>
<Delete>
  <Object><Key>o1.txt</Key></Object>
  <Object><Key>o2.txt</Key></Object>
</Delete>`;

      const delRes = await dispatch(
        ctx,
        new Request(`${base}/${bucket}?delete`, {
          method: "POST",
          headers: { ...h, "Content-Type": "application/xml" },
          body: deleteBody,
        }),
      );
      expect(delRes.status).toBe(200);
      const delXml = await delRes.text();
      const parsed = xmlParser.parse(delXml) as {
        DeleteResult?: { Deleted?: unknown };
      };
      const deleted = parsed.DeleteResult?.Deleted;
      const rows = Array.isArray(deleted) ? deleted : deleted ? [deleted] : [];
      expect(rows.length).toBe(2);

      const g1 = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/o1.txt`, { method: "GET", headers: h }),
      );
      expect(g1.status).toBe(404);
    } finally {
      mock.stop();
    }
  });
});

describe("Object tagging", () => {
  test("PUT with x-amz-tagging and GET ?tagging", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const h = { Host: "127.0.0.1:8081" };
      const bucket = "tag-bucket";

      await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "PUT", headers: h }),
      );

      await dispatch(
        ctx,
        new Request(`${base}/${bucket}/tagged.txt`, {
          method: "PUT",
          headers: {
            ...h,
            "Content-Type": "application/octet-stream",
            "Content-Length": "3",
            "x-amz-tagging": "breed=corgi&age=2",
          },
          body: "hey",
        }),
      );

      const tagRes = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/tagged.txt?tagging`, {
          method: "GET",
          headers: h,
        }),
      );
      expect(tagRes.status).toBe(200);
      const tagXml = await tagRes.text();
      expect(tagXml).toContain("breed");
      expect(tagXml).toContain("corgi");
      expect(tagXml).toContain("age");
      expect(tagXml).toContain("2");
    } finally {
      mock.stop();
    }
  });
});
