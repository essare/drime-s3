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
    insecure: true,
  };
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

async function uploadAt(
  baseUrl: string,
  workspaceId: number,
  parentId: number,
  relativePath: string,
): Promise<void> {
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([relativePath]),
    relativePath.split("/").pop() ?? "f",
  );
  fd.append("relativePath", relativePath);
  fd.append("workspaceId", String(workspaceId));
  fd.append("parentId", String(parentId));
  const res = await fetch(`${baseUrl}/uploads`, { method: "POST", body: fd });
  expect(res.ok).toBe(true);
}

describe("ListObjects", () => {
  test("delimiter=/ returns CommonPrefixes for child folders", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const h = { Host: "127.0.0.1:8081" };
      const bucket = "list-delim-bucket";

      await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "PUT", headers: h }),
      );
      const root = await ctx.drime.listFolder(null, 1);
      const b = root.find((e) => e.name === bucket);
      if (!b) {
        throw new Error("expected bucket folder");
      }
      await ctx.drime.createFolder("nested", {
        parentId: b.id,
        workspaceId: 1,
      });
      ctx.listCache.invalidate(null);
      ctx.listCache.invalidate(b.id);

      const res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}?delimiter=${encodeURIComponent("/")}`, {
          method: "GET",
          headers: h,
        }),
      );
      expect(res.status).toBe(200);
      const xml = await res.text();
      expect(xml).toContain("CommonPrefixes");
      expect(xml).toContain("nested/");
    } finally {
      mock.stop();
    }
  });

  test("no delimiter returns recursive object keys", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const h = { Host: "127.0.0.1:8081" };
      const bucket = "list-rec-bucket";

      await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "PUT", headers: h }),
      );
      const root = await ctx.drime.listFolder(null, 1);
      const b = root.find((e) => e.name === bucket);
      if (!b) {
        throw new Error("expected bucket folder");
      }
      await ctx.drime.createFolder("deep", {
        parentId: b.id,
        workspaceId: 1,
      });
      ctx.listCache.invalidate(null);
      ctx.listCache.invalidate(b.id);

      const deep = await ctx.drime.listFolder(b.id, 1);
      const d = deep.find((e) => e.name === "deep" && e.is_folder);
      if (!d) {
        throw new Error("expected deep folder");
      }
      await uploadAt(mock.baseUrl, 1, d.id, "deep/obj.bin");
      ctx.listCache.invalidate(null);
      ctx.listCache.invalidate(b.id);
      ctx.listCache.invalidate(d.id);

      const res = await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "GET", headers: h }),
      );
      expect(res.status).toBe(200);
      const xml = await res.text();
      expect(xml).toContain("deep/obj.bin");
    } finally {
      mock.stop();
    }
  });

  test("list-type=2 with max-keys=2 paginates via continuation-token", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const h = { Host: "127.0.0.1:8081" };
      const bucket = "list-page-bucket";

      await dispatch(
        ctx,
        new Request(`${base}/${bucket}`, { method: "PUT", headers: h }),
      );
      const root = await ctx.drime.listFolder(null, 1);
      const b = root.find((e) => e.name === bucket);
      if (!b) {
        throw new Error("expected bucket folder");
      }
      for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
        await uploadAt(mock.baseUrl, 1, b.id, name);
      }
      ctx.listCache.invalidate(null);
      ctx.listCache.invalidate(b.id);

      const u1 = new URL(`${base}/${bucket}`);
      u1.searchParams.set("list-type", "2");
      u1.searchParams.set("max-keys", "2");
      const r1 = await dispatch(
        ctx,
        new Request(u1.toString(), { method: "GET", headers: h }),
      );
      expect(r1.status).toBe(200);
      const x1 = await r1.text();
      const j1 = xmlParser.parse(x1) as {
        ListBucketResult?: {
          KeyCount?: number;
          IsTruncated?: string | boolean;
          NextContinuationToken?: string;
        };
      };
      expect(j1.ListBucketResult?.KeyCount).toBe(2);
      expect(
        j1.ListBucketResult?.IsTruncated === true ||
          j1.ListBucketResult?.IsTruncated === "true",
      ).toBe(true);
      const next = j1.ListBucketResult?.NextContinuationToken;
      if (typeof next !== "string" || next.length === 0) {
        throw new Error("expected NextContinuationToken");
      }

      const u2 = new URL(`${base}/${bucket}`);
      u2.searchParams.set("list-type", "2");
      u2.searchParams.set("max-keys", "2");
      u2.searchParams.set("continuation-token", next);
      const r2 = await dispatch(
        ctx,
        new Request(u2.toString(), { method: "GET", headers: h }),
      );
      expect(r2.status).toBe(200);
      const x2 = await r2.text();
      const j2 = xmlParser.parse(x2) as {
        ListBucketResult?: {
          KeyCount?: number;
          IsTruncated?: string | boolean;
        };
      };
      expect(j2.ListBucketResult?.KeyCount).toBe(2);
      expect(
        j2.ListBucketResult?.IsTruncated === false ||
          j2.ListBucketResult?.IsTruncated === "false",
      ).toBe(true);
    } finally {
      mock.stop();
    }
  });
});
