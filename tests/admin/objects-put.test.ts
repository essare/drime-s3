import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("PUT /_admin/buckets/:b/objects/*key", () => {
  test("streams body into bucket; returns { etag, size }", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const body = "hello, drime";
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/folder/hello.txt`, {
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
      const j = (await res.json()) as { etag: string; size: number };
      expect(j.etag).toMatch(/^"[0-9a-f]{32}"$/);
      expect(j.size).toBe(body.length);

      const listed = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects?prefix=folder/`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      const lj = (await listed.json()) as { objects: { key: string }[] };
      expect(lj.objects.some((o) => o.key === "folder/hello.txt")).toBe(true);
    } finally {
      setup.cleanup();
    }
  });

  test("404 NoSuchBucket when bucket missing", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/nope/objects/file.txt`, {
          method: "PUT",
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
          body: "x",
        }),
      );
      expect(res.status).toBe(404);
    } finally {
      setup.cleanup();
    }
  });
});
