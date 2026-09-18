import { describe, expect, test } from "bun:test";
import { XMLParser } from "fast-xml-parser";
import pino from "pino";
import type { AppConfig } from "../../src/config";
import { dispatch } from "../../src/s3/router";
import { createAppContext } from "../../src/server-context";
import {
  type MockDrimeServer,
  startMockDrime,
} from "../fixtures/mock-drime/server";

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

const PLANTED_SECRET = "super-secret-token";
const HOST = "127.0.0.1:8081";
const BASE = `http://${HOST}`;
const H = { Host: HOST };

function capturingLogger(): { logger: pino.Logger; serialized: () => string } {
  const lines: string[] = [];
  return {
    logger: pino(
      { level: "trace" },
      {
        write(line: string) {
          lines.push(line);
        },
      },
    ),
    serialized: () => lines.join("\n"),
  };
}

async function duplicateExactName(
  ctx: Awaited<ReturnType<typeof createAppContext>>,
  mock: MockDrimeServer,
  bucket: string,
  key: string,
): Promise<{ originalId: number; cloneId: number }> {
  const original = mock.snapshotFileEntries().find((e) => e.name === key);
  expect(original).toBeDefined();
  const cloneId = mock.cloneFileById(original?.id ?? 0);
  expect(cloneId).toBeDefined();
  const ws = ctx.gatewayWorkspaceId ?? 1;
  const roots = await ctx.drime.listFolder(null, ws);
  const bucketFolder = roots.find((e) => e.is_folder && e.name === bucket);
  expect(bucketFolder).toBeDefined();
  ctx.listCache.invalidate(bucketFolder?.id ?? 0);
  return { originalId: original?.id ?? 0, cloneId: cloneId ?? 0 };
}

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

  test("copy overwrite metadata failure preserves dest bytes and omits planted body", async () => {
    const mock = await startMockDrime();
    const capture = capturingLogger();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: capture.logger,
      });
      const bucket = "copy-overwrite-bucket";
      await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}`, { method: "PUT", headers: H }),
      );

      const destPut = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/dest.bin`, {
          method: "PUT",
          headers: {
            ...H,
            "Content-Type": "application/octet-stream",
            "Content-Length": "14",
          },
          body: "old-dest-bytes",
        }),
      );
      expect(destPut.status).toBe(200);

      const srcPut = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/src.bin`, {
          method: "PUT",
          headers: {
            ...H,
            "Content-Type": "application/octet-stream",
            "Content-Length": "14",
          },
          body: "new-src-bytes!",
        }),
      );
      expect(srcPut.status).toBe(200);

      mock.faultBody = JSON.stringify({
        error: "forced failure",
        token: PLANTED_SECRET,
      });
      mock.metadataFailureCount = 1;

      const copy = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/dest.bin`, {
          method: "PUT",
          headers: {
            ...H,
            "x-amz-copy-source": encodeURIComponent(`/${bucket}/src.bin`),
          },
        }),
      );
      expect(copy.status).toBe(500);
      const xml = await copy.text();
      expect(xml).toContain("InternalError");
      expect(xml).toContain("Copy failed.");
      expect(xml).not.toContain(PLANTED_SECRET);
      expect(xml).not.toContain("forced failure");

      const logs = capture.serialized();
      expect(logs).not.toContain(PLANTED_SECRET);
      expect(logs).not.toContain("forced failure");

      const got = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/dest.bin`, {
          method: "GET",
          headers: H,
        }),
      );
      expect(got.status).toBe(200);
      expect(await got.text()).toBe("old-dest-bytes");
    } finally {
      mock.stop();
    }
  });

  test("copy upload failure omits planted Drime body from S3 XML and logs", async () => {
    const mock = await startMockDrime();
    const capture = capturingLogger();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: capture.logger,
      });
      const bucket = "copy-upload-secret-bucket";
      await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}`, { method: "PUT", headers: H }),
      );
      const srcPut = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/src.bin`, {
          method: "PUT",
          headers: {
            ...H,
            "Content-Type": "application/octet-stream",
            "Content-Length": "14",
          },
          body: "copy-src-bytes",
        }),
      );
      expect(srcPut.status).toBe(200);

      mock.faultBody = JSON.stringify({
        error: "forced failure",
        token: PLANTED_SECRET,
      });
      mock.uploadFailureCount = 1;

      const copy = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/dest.bin`, {
          method: "PUT",
          headers: {
            ...H,
            "x-amz-copy-source": encodeURIComponent(`/${bucket}/src.bin`),
          },
        }),
      );
      expect(copy.status).toBe(500);
      const xml = await copy.text();
      expect(xml).toContain("InternalError");
      expect(xml).toContain("Copy failed.");
      expect(xml).not.toContain(PLANTED_SECRET);
      expect(xml).not.toContain("forced failure");
      expect(capture.serialized()).not.toContain(PLANTED_SECRET);
      expect(capture.serialized()).not.toContain("forced failure");
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

  test("copy destination overwrite rejects retained exact-name duplicates", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const bucket = "dup-copy-bucket";
      await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}`, { method: "PUT", headers: H }),
      );
      const destPut = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/dest.bin`, {
          method: "PUT",
          headers: {
            ...H,
            "Content-Type": "application/octet-stream",
            "Content-Length": "14",
          },
          body: "old-dest-bytes",
        }),
      );
      expect(destPut.status).toBe(200);
      const srcPut = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/src.bin`, {
          method: "PUT",
          headers: {
            ...H,
            "Content-Type": "application/octet-stream",
            "Content-Length": "14",
          },
          body: "new-src-bytes!",
        }),
      );
      expect(srcPut.status).toBe(200);
      const ids = await duplicateExactName(ctx, mock, bucket, "dest.bin");

      const copy = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/dest.bin`, {
          method: "PUT",
          headers: {
            ...H,
            "x-amz-copy-source": encodeURIComponent(`/${bucket}/src.bin`),
          },
        }),
      );
      expect(copy.status).toBe(500);
      const xml = await copy.text();
      expect(xml).toContain("InternalError");
      expect(xml).toContain("Object key is ambiguous.");
      expect(
        mock
          .snapshotFileEntries()
          .filter((e) => e.name === "dest.bin")
          .map((e) => e.id)
          .sort(),
      ).toEqual([ids.originalId, ids.cloneId].sort());
    } finally {
      mock.stop();
    }
  });

  test("DeleteObjects rejects a key with retained exact-name duplicates", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const bucket = "dup-batch-del-bucket";
      await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}`, { method: "PUT", headers: H }),
      );
      const put = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/dup.bin`, {
          method: "PUT",
          headers: {
            ...H,
            "Content-Type": "application/octet-stream",
            "Content-Length": "3",
          },
          body: "old",
        }),
      );
      expect(put.status).toBe(200);
      const ids = await duplicateExactName(ctx, mock, bucket, "dup.bin");

      const delRes = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}?delete`, {
          method: "POST",
          headers: { ...H, "Content-Type": "application/xml" },
          body: `<?xml version="1.0" encoding="UTF-8"?>
<Delete>
  <Object><Key>dup.bin</Key></Object>
</Delete>`,
        }),
      );
      expect(delRes.status).toBe(200);
      const xml = await delRes.text();
      expect(xml).toContain("InternalError");
      expect(xml).toContain("Object key is ambiguous.");
      expect(xml).not.toContain("<Deleted>");
      expect(
        mock
          .snapshotFileEntries()
          .filter((e) => e.name === "dup.bin")
          .map((e) => e.id)
          .sort(),
      ).toEqual([ids.originalId, ids.cloneId].sort());
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

  test("PUT tagging overwrite rejects retained exact-name duplicates", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const bucket = "dup-tag-bucket";
      await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}`, { method: "PUT", headers: H }),
      );
      const put = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/tagged.txt`, {
          method: "PUT",
          headers: {
            ...H,
            "Content-Type": "application/octet-stream",
            "Content-Length": "3",
            "x-amz-tagging": "breed=corgi",
          },
          body: "hey",
        }),
      );
      expect(put.status).toBe(200);
      const ids = await duplicateExactName(ctx, mock, bucket, "tagged.txt");

      const tagged = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/tagged.txt`, {
          method: "PUT",
          headers: {
            ...H,
            "Content-Type": "application/octet-stream",
            "Content-Length": "3",
            "x-amz-tagging": "breed=lab",
          },
          body: "hey",
        }),
      );
      expect(tagged.status).toBe(500);
      const xml = await tagged.text();
      expect(xml).toContain("Object key is ambiguous.");
      expect(
        mock
          .snapshotFileEntries()
          .filter((e) => e.name === "tagged.txt")
          .map((e) => e.id)
          .sort(),
      ).toEqual([ids.originalId, ids.cloneId].sort());

      const tagRes = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/tagged.txt?tagging`, {
          method: "GET",
          headers: H,
        }),
      );
      expect(tagRes.status).toBe(200);
      expect(await tagRes.text()).toContain("corgi");
    } finally {
      mock.stop();
    }
  });
});
