import { describe, expect, test } from "bun:test";
import { XMLParser } from "fast-xml-parser";
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
/** Independent composite ETag of two 16-byte parts `a`×16 and `b`×16. */
const TWO_PART_COMPOSITE = "083e0a48918140c9fba21e13c232a17d-2";
const PART_A = Buffer.from("aaaaaaaaaaaaaaaa");
const PART_B = Buffer.from("bbbbbbbbbbbbbbbb");
const PLANTED_SECRET = "super-secret-token";

const xmlParser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

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

async function createCtx(
  apiBaseUrl: string,
  logger: pino.Logger = pino({ level: "silent" }),
): Promise<AppContext> {
  return createAppContext({
    config: testConfig(apiBaseUrl),
    logger,
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

async function listBucket(ctx: AppContext, bucket: string): Promise<Response> {
  return dispatch(
    ctx,
    new Request(`${BASE}/${bucket}?list-type=2`, {
      method: "GET",
      headers: H,
    }),
  );
}

function quoteEtag(raw: string): string {
  const bare = raw.replace(/^"+|"+$/g, "");
  return `"${bare}"`;
}

function parseUploadId(initXml: string): string {
  const initDoc = xmlParser.parse(initXml) as Record<string, unknown>;
  const initRoot =
    initDoc.InitiateMultipartUploadResult ??
    initDoc.initiateMultipartUploadResult;
  expect(initRoot && typeof initRoot === "object").toBe(true);
  return String((initRoot as Record<string, unknown>).UploadId ?? "");
}

function parseCompleteEtag(completeXml: string): string {
  const completeDoc = xmlParser.parse(completeXml) as Record<string, unknown>;
  const completeRoot =
    completeDoc.CompleteMultipartUploadResult ??
    completeDoc.completeMultipartUploadResult;
  expect(completeRoot && typeof completeRoot === "object").toBe(true);
  return String((completeRoot as Record<string, unknown>).ETag ?? "").replace(
    /^"+|"+$/g,
    "",
  );
}

function parseListContents(
  listXml: string,
): Array<{ key: string; etag: string }> {
  const doc = xmlParser.parse(listXml) as Record<string, unknown>;
  const root = doc.ListBucketResult ?? doc.listBucketResult;
  expect(root && typeof root === "object").toBe(true);
  const contents = (root as Record<string, unknown>).Contents;
  if (contents === undefined) return [];
  const rows = Array.isArray(contents) ? contents : [contents];
  return rows.map((row) => {
    const o = row as Record<string, unknown>;
    return {
      key: String(o.Key ?? ""),
      etag: String(o.ETag ?? "").replace(/^"+|"+$/g, ""),
    };
  });
}

async function initiateMultipart(
  ctx: AppContext,
  bucket: string,
  key: string,
): Promise<string> {
  const init = await dispatch(
    ctx,
    new Request(`${BASE}/${bucket}/${key}?uploads=`, {
      method: "POST",
      headers: H,
    }),
  );
  expect(init.status).toBe(200);
  const uploadId = parseUploadId(await init.text());
  expect(uploadId.length).toBeGreaterThan(4);
  return uploadId;
}

async function uploadPart(
  ctx: AppContext,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  body: Buffer,
): Promise<string> {
  const partPut = await dispatch(
    ctx,
    new Request(
      `${BASE}/${bucket}/${key}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`,
      {
        method: "PUT",
        headers: {
          ...H,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(body.length),
        },
        body: new Uint8Array(body),
      },
    ),
  );
  return partPut.headers.get("etag")?.replace(/^"+|"+$/g, "") ?? "";
}

async function completeMultipart(
  ctx: AppContext,
  bucket: string,
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<Response> {
  const partXml = parts
    .map(
      (p) => `  <Part>
    <PartNumber>${p.partNumber}</PartNumber>
    <ETag>${quoteEtag(p.etag)}</ETag>
  </Part>`,
    )
    .join("\n");
  const completeBody = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
${partXml}
</CompleteMultipartUpload>`;
  return dispatch(
    ctx,
    new Request(
      `${BASE}/${bucket}/${key}?uploadId=${encodeURIComponent(uploadId)}`,
      {
        method: "POST",
        headers: {
          ...H,
          "Content-Type": "application/xml",
          "Content-Length": String(Buffer.byteLength(completeBody, "utf8")),
        },
        body: completeBody,
      },
    ),
  );
}

async function uploadTwoParts(
  ctx: AppContext,
  bucket: string,
  key: string,
): Promise<{ uploadId: string; etag1: string; etag2: string }> {
  const uploadId = await initiateMultipart(ctx, bucket, key);
  const etag1 = await uploadPart(ctx, bucket, key, uploadId, 1, PART_A);
  expect(etag1.length).toBeGreaterThan(0);
  const etag2 = await uploadPart(ctx, bucket, key, uploadId, 2, PART_B);
  expect(etag2.length).toBeGreaterThan(0);
  return { uploadId, etag1, etag2 };
}

async function seedBucketWithOldObject(
  mockOptions: Parameters<typeof startMockDrime>[0],
  bucket: string,
  key: string,
): Promise<{
  mock: MockDrimeServer;
  ctx: AppContext;
  capture: ReturnType<typeof capturingLogger>;
  oldId: number;
}> {
  const mock = await startMockDrime(mockOptions);
  const capture = capturingLogger();
  const ctx = await createCtx(mock.baseUrl, capture.logger);
  const mk = await putBucket(ctx, bucket);
  expect(mk.status).toBe(200);
  const first = await putObject(ctx, bucket, key, "old-backup-v1");
  expect(first.status).toBe(200);
  expect(first.headers.get("etag")).toBe(`"${OLD_BACKUP_MD5}"`);
  const old = mock.snapshotFileEntries().find((e) => e.name === key);
  expect(old).toBeDefined();
  return { mock, ctx, capture, oldId: old?.id ?? 0 };
}

describe("S3 multipart upload", () => {
  test("POST uploads → PUT part → POST complete → GET object", async () => {
    const mock = await startMockDrime({ seedRootFolders: ["mp-bucket"] });
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const h = { Host: "127.0.0.1:8081" };
      const bucket = "mp-bucket";
      const objectKey = "big.bin";
      const partBody = Buffer.from("part-one-bytes", "utf8");

      const init = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}?uploads=`, {
          method: "POST",
          headers: h,
        }),
      );
      expect(init.status).toBe(200);
      const initXml = await init.text();
      expect(initXml).toContain("InitiateMultipartUploadResult");
      const uploadId = parseUploadId(initXml);
      expect(uploadId.length).toBeGreaterThan(4);

      const listBefore = await dispatch(
        ctx,
        new Request(
          `${base}/${bucket}/${objectKey}?uploadId=${encodeURIComponent(uploadId)}`,
          { method: "GET", headers: h },
        ),
      );
      expect(listBefore.status).toBe(200);

      const partPut = await dispatch(
        ctx,
        new Request(
          `${base}/${bucket}/${objectKey}?partNumber=1&uploadId=${encodeURIComponent(uploadId)}`,
          {
            method: "PUT",
            headers: {
              ...h,
              "Content-Type": "application/octet-stream",
              "Content-Length": String(partBody.length),
            },
            body: partBody,
          },
        ),
      );
      expect(partPut.status).toBe(200);
      const partEtag =
        partPut.headers.get("etag")?.replace(/^"+|"+$/g, "") ?? "";

      const listAfter = await dispatch(
        ctx,
        new Request(
          `${base}/${bucket}/${objectKey}?uploadId=${encodeURIComponent(uploadId)}`,
          { method: "GET", headers: h },
        ),
      );
      expect(listAfter.status).toBe(200);
      const listXml = await listAfter.text();
      expect(listXml).toContain("<PartNumber>1</PartNumber>");

      const complete = await completeMultipart(
        ctx,
        bucket,
        objectKey,
        uploadId,
        [{ partNumber: 1, etag: partEtag }],
      );
      expect(complete.status).toBe(200);
      const completeXml = await complete.text();
      expect(completeXml).toContain("CompleteMultipartUploadResult");
      const completeEtag = parseCompleteEtag(completeXml);
      expect(completeEtag).toMatch(/^[a-f0-9]{32}-1$/);

      const head = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "HEAD",
          headers: h,
        }),
      );
      expect(head.status).toBe(200);
      const headEtag = head.headers.get("etag")?.replace(/^"+|"+$/g, "") ?? "";
      expect(headEtag).toBe(completeEtag);

      const get = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "GET",
          headers: h,
        }),
      );
      expect(get.status).toBe(200);
      const buf = Buffer.from(await get.arrayBuffer());
      expect(buf.equals(partBody)).toBe(true);
      expect(get.headers.get("etag")?.replace(/^"+|"+$/g, "")).toBe(
        completeEtag,
      );
    } finally {
      mock.stop();
    }
  });

  test("overwrites an existing key while two post-delete listings remain stale", async () => {
    const { mock, ctx } = await seedBucketWithOldObject(
      { staleListingsAfterDelete: 2 },
      "mp-stale-bucket",
      "backup.bin",
    );
    try {
      const { uploadId, etag1, etag2 } = await uploadTwoParts(
        ctx,
        "mp-stale-bucket",
        "backup.bin",
      );
      const complete = await completeMultipart(
        ctx,
        "mp-stale-bucket",
        "backup.bin",
        uploadId,
        [
          { partNumber: 1, etag: etag1 },
          { partNumber: 2, etag: etag2 },
        ],
      );
      expect(complete.status).toBe(200);
      const completeEtag = parseCompleteEtag(await complete.text());
      expect(completeEtag).toBe(TWO_PART_COMPOSITE);

      const head = await headObject(ctx, "mp-stale-bucket", "backup.bin");
      expect(head.status).toBe(200);
      expect(head.headers.get("etag")?.replace(/^"+|"+$/g, "")).toBe(
        completeEtag,
      );

      const got = await getObject(ctx, "mp-stale-bucket", "backup.bin");
      expect(got.status).toBe(200);
      expect(
        Buffer.from(await got.arrayBuffer()).equals(
          Buffer.concat([PART_A, PART_B]),
        ),
      ).toBe(true);
      expect(got.headers.get("etag")?.replace(/^"+|"+$/g, "")).toBe(
        completeEtag,
      );
    } finally {
      mock.stop();
    }
  });

  test("Complete response ETag equals immediate HEAD and GET ETag", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createCtx(mock.baseUrl);
      const bucket = "mp-etag-bucket";
      await putBucket(ctx, bucket);
      const { uploadId, etag1, etag2 } = await uploadTwoParts(
        ctx,
        bucket,
        "fresh.bin",
      );
      const complete = await completeMultipart(
        ctx,
        bucket,
        "fresh.bin",
        uploadId,
        [
          { partNumber: 1, etag: etag1 },
          { partNumber: 2, etag: etag2 },
        ],
      );
      expect(complete.status).toBe(200);
      const completeEtag = parseCompleteEtag(await complete.text());
      expect(completeEtag).toBe(TWO_PART_COMPOSITE);

      const head = await headObject(ctx, bucket, "fresh.bin");
      expect(head.status).toBe(200);
      expect(head.headers.get("etag")?.replace(/^"+|"+$/g, "")).toBe(
        completeEtag,
      );

      const got = await getObject(ctx, bucket, "fresh.bin");
      expect(got.status).toBe(200);
      expect(got.headers.get("etag")?.replace(/^"+|"+$/g, "")).toBe(
        completeEtag,
      );
    } finally {
      mock.stop();
    }
  });

  test("old Drive id never resurfaces through ListObjects after overwrite", async () => {
    const { mock, ctx, oldId } = await seedBucketWithOldObject(
      { staleListingsAfterDelete: 2 },
      "mp-list-bucket",
      "backup.bin",
    );
    try {
      const { uploadId, etag1, etag2 } = await uploadTwoParts(
        ctx,
        "mp-list-bucket",
        "backup.bin",
      );
      const complete = await completeMultipart(
        ctx,
        "mp-list-bucket",
        "backup.bin",
        uploadId,
        [
          { partNumber: 1, etag: etag1 },
          { partNumber: 2, etag: etag2 },
        ],
      );
      expect(complete.status).toBe(200);
      const completeEtag = parseCompleteEtag(await complete.text());

      const listed = await listBucket(ctx, "mp-list-bucket");
      expect(listed.status).toBe(200);
      const contents = parseListContents(await listed.text());
      expect(contents).toEqual([{ key: "backup.bin", etag: completeEtag }]);

      const live = mock
        .snapshotFileEntries()
        .filter((e) => e.name === "backup.bin");
      expect(live).toHaveLength(1);
      expect(live[0]?.id).not.toBe(oldId);
    } finally {
      mock.stop();
    }
  });

  test("metadata failure returns 500, preserves old bytes, and omits planted bodies", async () => {
    const { mock, ctx, capture } = await seedBucketWithOldObject(
      {},
      "mp-meta-bucket",
      "backup.bin",
    );
    try {
      mock.faultBody = JSON.stringify({
        error: "forced failure",
        token: PLANTED_SECRET,
      });
      mock.metadataFailureCount = 1;
      const { uploadId, etag1, etag2 } = await uploadTwoParts(
        ctx,
        "mp-meta-bucket",
        "backup.bin",
      );
      const complete = await completeMultipart(
        ctx,
        "mp-meta-bucket",
        "backup.bin",
        uploadId,
        [
          { partNumber: 1, etag: etag1 },
          { partNumber: 2, etag: etag2 },
        ],
      );
      expect(complete.status).toBe(500);
      const xml = await complete.text();
      expect(xml).toContain("InternalError");
      expect(xml).not.toContain(PLANTED_SECRET);
      expect(xml).not.toContain("forced failure");
      expect(capture.serialized()).not.toContain(PLANTED_SECRET);
      expect(capture.serialized()).not.toContain("forced failure");

      const got = await getObject(ctx, "mp-meta-bucket", "backup.bin");
      expect(got.status).toBe(200);
      expect(await got.text()).toBe("old-backup-v1");
    } finally {
      mock.stop();
    }
  });

  test("422 whose listing shows candidate present and old absent still commits", async () => {
    const { mock, ctx, oldId } = await seedBucketWithOldObject(
      {},
      "mp-422-bucket",
      "backup.bin",
    );
    try {
      mock.deleteInvalidIdsCount = 1;
      const { uploadId, etag1, etag2 } = await uploadTwoParts(
        ctx,
        "mp-422-bucket",
        "backup.bin",
      );
      const complete = await completeMultipart(
        ctx,
        "mp-422-bucket",
        "backup.bin",
        uploadId,
        [
          { partNumber: 1, etag: etag1 },
          { partNumber: 2, etag: etag2 },
        ],
      );
      expect(complete.status).toBe(200);
      const completeEtag = parseCompleteEtag(await complete.text());
      expect(completeEtag).toBe(TWO_PART_COMPOSITE);

      const got = await getObject(ctx, "mp-422-bucket", "backup.bin");
      expect(got.status).toBe(200);
      expect(
        Buffer.from(await got.arrayBuffer()).equals(
          Buffer.concat([PART_A, PART_B]),
        ),
      ).toBe(true);

      const live = mock
        .snapshotFileEntries()
        .filter((e) => e.name === "backup.bin");
      expect(live).toHaveLength(1);
      expect(live[0]?.id).not.toBe(oldId);
    } finally {
      mock.stop();
    }
  });

  test("unresolved old deletion retains the candidate, publishes no success, and returns an error", async () => {
    const { mock, ctx, oldId } = await seedBucketWithOldObject(
      {},
      "mp-unresolved-bucket",
      "backup.bin",
    );
    try {
      mock.deleteFailureCount = 1;
      mock.emptyListingCount = 5;
      const { uploadId, etag1, etag2 } = await uploadTwoParts(
        ctx,
        "mp-unresolved-bucket",
        "backup.bin",
      );
      const complete = await completeMultipart(
        ctx,
        "mp-unresolved-bucket",
        "backup.bin",
        uploadId,
        [
          { partNumber: 1, etag: etag1 },
          { partNumber: 2, etag: etag2 },
        ],
      );
      expect(complete.status).toBe(500);
      const xml = await complete.text();
      expect(xml).toContain("InternalError");
      expect(xml).not.toContain("CompleteMultipartUploadResult");

      const live = mock
        .snapshotFileEntries()
        .filter((e) => e.name === "backup.bin");
      expect(live.map((e) => e.id)).toContain(oldId);
      expect(live.length).toBe(2);

      const got = await getObject(ctx, "mp-unresolved-bucket", "backup.bin");
      expect(got.status).toBe(200);
      expect(await got.text()).toBe("old-backup-v1");
    } finally {
      mock.stop();
    }
  }, 15_000);

  test("part status sequence [502, 200] completes successfully with two 16-byte parts", async () => {
    const mock = await startMockDrime({ partPutStatuses: [502, 200] });
    try {
      const ctx = await createCtx(mock.baseUrl);
      const bucket = "mp-retry-bucket";
      await putBucket(ctx, bucket);
      const { uploadId, etag1, etag2 } = await uploadTwoParts(
        ctx,
        bucket,
        "retry.bin",
      );
      expect(etag1.length).toBeGreaterThan(0);
      expect(etag2.length).toBeGreaterThan(0);

      const complete = await completeMultipart(
        ctx,
        bucket,
        "retry.bin",
        uploadId,
        [
          { partNumber: 1, etag: etag1 },
          { partNumber: 2, etag: etag2 },
        ],
      );
      expect(complete.status).toBe(200);
      const completeEtag = parseCompleteEtag(await complete.text());
      expect(completeEtag).toBe(TWO_PART_COMPOSITE);

      expect(mock.partPutReceipts).toEqual([
        { partNumber: 1, status: 502, bytes: 16 },
        { partNumber: 1, status: 200, bytes: 16 },
        { partNumber: 2, status: 200, bytes: 16 },
      ]);
      expect(mock.multipartCompleteCount).toBe(1);

      const got = await getObject(ctx, bucket, "retry.bin");
      expect(got.status).toBe(200);
      expect(
        Buffer.from(await got.arrayBuffer()).equals(
          Buffer.concat([PART_A, PART_B]),
        ),
      ).toBe(true);
      expect(got.headers.get("etag")?.replace(/^"+|"+$/g, "")).toBe(
        completeEtag,
      );
    } finally {
      mock.stop();
    }
  });
});
