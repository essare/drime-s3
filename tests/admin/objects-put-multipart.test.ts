import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

/**
 * Verifies the gateway-internal multipart fallback path that kicks in when
 * a single PUT body exceeds the (tunable) Cloudflare-safe threshold.
 *
 * We lower the threshold and part size via env vars so the test can finish
 * in milliseconds with a few hundred KB of data instead of 100+ MiB.
 */
describe("PUT /_admin/buckets/:b/objects/*key (multipart fallback)", () => {
  const prevThreshold = process.env.DRIME_S3_MULTIPART_THRESHOLD_BYTES;
  const prevPartSize = process.env.DRIME_S3_MULTIPART_PART_SIZE_BYTES;

  beforeEach(() => {
    process.env.DRIME_S3_MULTIPART_THRESHOLD_BYTES = String(100 * 1024); // 100 KB
    process.env.DRIME_S3_MULTIPART_PART_SIZE_BYTES = String(64 * 1024); // 64 KB
  });

  afterEach(() => {
    if (prevThreshold === undefined) {
      delete process.env.DRIME_S3_MULTIPART_THRESHOLD_BYTES;
    } else {
      process.env.DRIME_S3_MULTIPART_THRESHOLD_BYTES = prevThreshold;
    }
    if (prevPartSize === undefined) {
      delete process.env.DRIME_S3_MULTIPART_PART_SIZE_BYTES;
    } else {
      process.env.DRIME_S3_MULTIPART_PART_SIZE_BYTES = prevPartSize;
    }
  });

  test("uses multipart for bodies above the threshold and returns composite ETag", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      // 256 KB > 100 KB threshold; with 64 KB parts -> 4 parts.
      const totalSize = 256 * 1024;
      const body = Buffer.alloc(totalSize);
      for (let i = 0; i < totalSize; i++) {
        body[i] = i & 0xff;
      }

      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/big.bin`, {
          method: "PUT",
          headers: {
            Host: "127.0.0.1:8081",
            Cookie: cookie,
            Origin: ORIG,
            "Content-Type": "application/octet-stream",
            "Content-Length": String(totalSize),
          },
          body,
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { etag: string; size: number };
      expect(j.size).toBe(totalSize);
      // Composite multipart ETag: 32-hex-md5 + "-" + partCount, quoted.
      expect(j.etag).toMatch(/^"[0-9a-f]{32}-4"$/);

      const listed = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects?prefix=`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      const lj = (await listed.json()) as {
        objects: { key: string; size: number; etag: string }[];
      };
      const obj = lj.objects.find((o) => o.key === "big.bin");
      expect(obj).toBeDefined();
      expect(obj?.size).toBe(totalSize);
      // Subsequent listings should surface the same composite ETag (persisted
      // in the entry description by the multipart path).
      expect(obj?.etag).toMatch(/^"[0-9a-f]{32}-4"$/);
    } finally {
      setup.cleanup();
    }
  });

  test("still uses single-PUT for bodies under the threshold", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const body = "small body";
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/small.txt`, {
          method: "PUT",
          headers: {
            Host: "127.0.0.1:8081",
            Cookie: cookie,
            Origin: ORIG,
            "Content-Type": "text/plain",
            "Content-Length": String(body.length),
          },
          body,
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { etag: string };
      // Single-MD5 ETag, no "-N" suffix.
      expect(j.etag).toMatch(/^"[0-9a-f]{32}"$/);
    } finally {
      setup.cleanup();
    }
  });
});
