import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";
function H(cookie: string) {
  return { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG };
}

async function putViaS3(
  setup: { call: (r: Request) => Promise<Response> },
  bucket: string,
  key: string,
  body: string,
) {
  const r = await setup.call(
    new Request(`${ORIG}/${bucket}/${key}`, {
      method: "PUT",
      headers: {
        Host: "127.0.0.1:8081",
        "Content-Length": String(body.length),
      },
      body,
    }),
  );
  if (r.status !== 200) throw new Error(`put failed ${r.status}`);
}

describe("GET /_admin/buckets/:b/objects", () => {
  test("returns JSON listing with delimiter splitting prefixes", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      await putViaS3(setup, "docs", "a.txt", "hello");
      await putViaS3(setup, "docs", "sub/b.txt", "world");
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects?delimiter=/`, {
          headers: H(cookie),
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as {
        prefix: string;
        delimiter: string;
        objects: { key: string; size: number; etag: string }[];
        commonPrefixes: string[];
        nextToken: string | null;
      };
      expect(j.prefix).toBe("");
      expect(j.delimiter).toBe("/");
      expect(j.objects.map((o) => o.key)).toEqual(["a.txt"]);
      expect(j.commonPrefixes).toEqual(["sub/"]);
      expect(j.nextToken).toBeNull();
    } finally {
      setup.cleanup();
    }
  });

  test("404 NoSuchBucket when bucket missing", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/nope/objects`, {
          headers: H(cookie),
        }),
      );
      expect(res.status).toBe(404);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("NoSuchBucket");
    } finally {
      setup.cleanup();
    }
  });
});
