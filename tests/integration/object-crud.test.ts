import { describe, expect, test } from "bun:test";
import pino from "pino";
import type { AppConfig } from "../../src/config";
import { dispatch } from "../../src/s3/router";
import { type AppContext, createAppContext } from "../../src/server-context";
import {
  type MockDrimeServer,
  startMockDrime,
} from "../fixtures/mock-drime/server";

const HOST = "127.0.0.1:8081";
const BASE = `http://${HOST}`;
const H = { Host: HOST };

/** Independent MD5 of `old-backup-v1` (Python hashlib). */
const OLD_BACKUP_MD5 = "54f5724a5d9eb20787d75f87e11a1651";
/** Independent MD5 of `new-backup-v2` (Python hashlib). */
const NEW_BACKUP_MD5 = "d8f9416b74f6ac906038204b79b7022e";
/** Independent MD5 of `abcdefghijklmnopqrstuvwxyz012345` (Python hashlib). */
const MULTIPART_BODY_MD5 = "357e82db934fc45f4a25b4b83dc8bd19";
const MULTIPART_BODY = "abcdefghijklmnopqrstuvwxyz012345";
const PLANTED_SECRET = "super-secret-token";

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

async function createCtx(apiBaseUrl: string): Promise<AppContext> {
  return createAppContext({
    config: testConfig(apiBaseUrl),
    logger: pino({ level: "silent" }),
  });
}

async function putBucket(ctx: AppContext, bucket: string): Promise<Response> {
  return dispatch(
    ctx,
    new Request(`${BASE}/${bucket}`, { method: "PUT", headers: H }),
  );
}

async function putObject(
  ctx: AppContext,
  bucket: string,
  key: string,
  body: string,
): Promise<Response> {
  return dispatch(
    ctx,
    new Request(`${BASE}/${bucket}/${key}`, {
      method: "PUT",
      headers: {
        ...H,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(Buffer.byteLength(body, "utf8")),
      },
      body,
    }),
  );
}

async function getObject(
  ctx: AppContext,
  bucket: string,
  key: string,
): Promise<Response> {
  return dispatch(
    ctx,
    new Request(`${BASE}/${bucket}/${key}`, { method: "GET", headers: H }),
  );
}

async function headObject(
  ctx: AppContext,
  bucket: string,
  key: string,
): Promise<Response> {
  return dispatch(
    ctx,
    new Request(`${BASE}/${bucket}/${key}`, { method: "HEAD", headers: H }),
  );
}

async function duplicateExactName(
  ctx: AppContext,
  mock: MockDrimeServer,
  bucket: string,
  key: string,
): Promise<{ originalId: number; cloneId: number }> {
  const name = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
  const original = mock.snapshotFileEntries().find((e) => e.name === name);
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

  test("overwrite backup.bin returns new bytes and full-body MD5", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createCtx(mock.baseUrl);
      const bucket = "replace-bucket";
      await putBucket(ctx, bucket);

      const first = await putObject(ctx, bucket, "backup.bin", "old-backup-v1");
      expect(first.status).toBe(200);
      expect(first.headers.get("etag")).toBe(`"${OLD_BACKUP_MD5}"`);

      const second = await putObject(
        ctx,
        bucket,
        "backup.bin",
        "new-backup-v2",
      );
      expect(second.status).toBe(200);
      expect(second.headers.get("etag")).toBe(`"${NEW_BACKUP_MD5}"`);

      const head = await headObject(ctx, bucket, "backup.bin");
      expect(head.status).toBe(200);
      expect(head.headers.get("etag")).toBe(`"${NEW_BACKUP_MD5}"`);

      const got = await getObject(ctx, bucket, "backup.bin");
      expect(got.status).toBe(200);
      expect(await got.text()).toBe("new-backup-v2");
      expect(got.headers.get("etag")).toBe(`"${NEW_BACKUP_MD5}"`);
    } finally {
      mock.stop();
    }
  });

  test("internal multipart PUT still returns full-body MD5", async () => {
    const mock = await startMockDrime();
    const prevThreshold = process.env.DRIME_S3_MULTIPART_THRESHOLD_BYTES;
    process.env.DRIME_S3_MULTIPART_THRESHOLD_BYTES = "8";
    try {
      const ctx = await createCtx(mock.baseUrl);
      const bucket = "mp-md5-bucket";
      await putBucket(ctx, bucket);

      const put = await putObject(ctx, bucket, "backup.bin", MULTIPART_BODY);
      expect(put.status).toBe(200);
      const etag = put.headers.get("etag");
      expect(etag).toBe(`"${MULTIPART_BODY_MD5}"`);
      expect(etag).not.toMatch(/-[0-9]+"$/);

      const head = await headObject(ctx, bucket, "backup.bin");
      expect(head.status).toBe(200);
      expect(head.headers.get("etag")).toBe(`"${MULTIPART_BODY_MD5}"`);

      const got = await getObject(ctx, bucket, "backup.bin");
      expect(got.status).toBe(200);
      expect(await got.text()).toBe(MULTIPART_BODY);
    } finally {
      if (prevThreshold === undefined) {
        delete process.env.DRIME_S3_MULTIPART_THRESHOLD_BYTES;
      } else {
        process.env.DRIME_S3_MULTIPART_THRESHOLD_BYTES = prevThreshold;
      }
      mock.stop();
    }
  });

  test("metadata failure during overwrite returns 500 and preserves old bytes", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createCtx(mock.baseUrl);
      const bucket = "meta-fail-bucket";
      await putBucket(ctx, bucket);

      const first = await putObject(ctx, bucket, "backup.bin", "old-backup-v1");
      expect(first.status).toBe(200);

      mock.metadataFailureCount = 1;
      const second = await putObject(
        ctx,
        bucket,
        "backup.bin",
        "new-backup-v2",
      );
      expect(second.status).toBe(500);
      expect(await second.text()).toContain("InternalError");

      const got = await getObject(ctx, bucket, "backup.bin");
      expect(got.status).toBe(200);
      expect(await got.text()).toBe("old-backup-v1");
    } finally {
      mock.stop();
    }
  });

  test("candidate upload failure preserves old bytes", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createCtx(mock.baseUrl);
      const bucket = "upload-fail-bucket";
      await putBucket(ctx, bucket);

      const first = await putObject(ctx, bucket, "backup.bin", "old-backup-v1");
      expect(first.status).toBe(200);

      mock.uploadFailureCount = 1;
      const second = await putObject(
        ctx,
        bucket,
        "backup.bin",
        "new-backup-v2",
      );
      expect(second.status).toBe(500);

      const got = await getObject(ctx, bucket, "backup.bin");
      expect(got.status).toBe(200);
      expect(await got.text()).toBe("old-backup-v1");
    } finally {
      mock.stop();
    }
  });

  test("candidate upload failure omits planted Drime body from S3 response and logs", async () => {
    const mock = await startMockDrime();
    const capture = capturingLogger();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: capture.logger,
      });
      const bucket = "upload-secret-bucket";
      await putBucket(ctx, bucket);

      const first = await putObject(ctx, bucket, "backup.bin", "old-backup-v1");
      expect(first.status).toBe(200);

      mock.faultBody = JSON.stringify({
        error: "forced failure",
        token: PLANTED_SECRET,
      });
      mock.uploadFailureCount = 1;
      const second = await putObject(
        ctx,
        bucket,
        "backup.bin",
        "new-backup-v2",
      );
      expect(second.status).toBe(500);
      const xml = await second.text();
      expect(xml).toContain("InternalError");
      expect(xml).toContain("Upload failed.");
      expect(xml).not.toContain(PLANTED_SECRET);
      expect(xml).not.toContain("forced failure");

      const logs = capture.serialized();
      expect(logs).not.toContain(PLANTED_SECRET);
      expect(logs).not.toContain("forced failure");

      const got = await getObject(ctx, bucket, "backup.bin");
      expect(got.status).toBe(200);
      expect(await got.text()).toBe("old-backup-v1");
    } finally {
      mock.stop();
    }
  });

  test("GET remains available for retained exact-name duplicates", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createCtx(mock.baseUrl);
      const bucket = "dup-get-bucket";
      await putBucket(ctx, bucket);
      const put = await putObject(ctx, bucket, "backup.bin", "old-backup-v1");
      expect(put.status).toBe(200);
      const ids = await duplicateExactName(ctx, mock, bucket, "backup.bin");

      const got = await getObject(ctx, bucket, "backup.bin");
      expect(got.status).toBe(200);
      expect(await got.text()).toBe("old-backup-v1");
      expect(
        mock
          .snapshotFileEntries()
          .filter((e) => e.name === "backup.bin")
          .map((e) => e.id)
          .sort(),
      ).toEqual([ids.originalId, ids.cloneId].sort());
    } finally {
      mock.stop();
    }
  });

  test("PUT overwrite rejects retained exact-name duplicates", async () => {
    const mock = await startMockDrime();
    const capture = capturingLogger();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: capture.logger,
      });
      const bucket = "dup-put-bucket";
      await putBucket(ctx, bucket);
      const put = await putObject(ctx, bucket, "backup.bin", "old-backup-v1");
      expect(put.status).toBe(200);
      const ids = await duplicateExactName(ctx, mock, bucket, "backup.bin");

      const second = await putObject(
        ctx,
        bucket,
        "backup.bin",
        "new-backup-v2",
      );
      expect(second.status).toBe(500);
      const xml = await second.text();
      expect(xml).toContain("InternalError");
      expect(xml).toContain("Object key is ambiguous.");
      expect(xml).not.toContain(String(ids.originalId));
      expect(xml).not.toContain(String(ids.cloneId));
      expect(capture.serialized()).toContain("ambiguous_object_key");
      expect(capture.serialized()).toContain(String(ids.originalId));
      expect(capture.serialized()).toContain(String(ids.cloneId));

      expect(
        mock
          .snapshotFileEntries()
          .filter((e) => e.name === "backup.bin")
          .map((e) => e.id)
          .sort(),
      ).toEqual([ids.originalId, ids.cloneId].sort());
      const got = await getObject(ctx, bucket, "backup.bin");
      expect(got.status).toBe(200);
      expect(await got.text()).toBe("old-backup-v1");
    } finally {
      mock.stop();
    }
  });

  test("DELETE rejects retained exact-name duplicates", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createCtx(mock.baseUrl);
      const bucket = "dup-del-bucket";
      await putBucket(ctx, bucket);
      const put = await putObject(ctx, bucket, "backup.bin", "old-backup-v1");
      expect(put.status).toBe(200);
      const ids = await duplicateExactName(ctx, mock, bucket, "backup.bin");

      const del = await dispatch(
        ctx,
        new Request(`${BASE}/${bucket}/backup.bin`, {
          method: "DELETE",
          headers: H,
        }),
      );
      expect(del.status).toBe(500);
      const xml = await del.text();
      expect(xml).toContain("InternalError");
      expect(xml).toContain("Object key is ambiguous.");

      expect(
        mock
          .snapshotFileEntries()
          .filter((e) => e.name === "backup.bin")
          .map((e) => e.id)
          .sort(),
      ).toEqual([ids.originalId, ids.cloneId].sort());
    } finally {
      mock.stop();
    }
  });
});
