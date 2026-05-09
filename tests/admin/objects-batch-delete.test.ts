import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("POST /_admin/buckets/:b/objects:batchDelete", () => {
  test("deletes multiple objects, reports errors per key", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const headers = { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG };
      for (const k of ["a.txt", "b.txt", "c.txt"]) {
        await setup.call(
          new Request(`${ORIG}/_admin/buckets/docs/objects/${k}`, {
            method: "PUT",
            headers: { ...headers, "Content-Length": "1" },
            body: "x",
          }),
        );
      }
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects:batchDelete`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ keys: ["a.txt", "missing.txt", "b.txt"] }),
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { deleted: string[]; errors: { key: string }[] };
      expect(j.deleted.sort()).toEqual(["a.txt", "b.txt", "missing.txt"]);
      expect(j.errors).toEqual([]);
    } finally {
      setup.cleanup();
    }
  });

  test("400 when keys is missing or > 1000", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2", seedRootFolders: ["docs"] });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const headers = {
        Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG, "Content-Type": "application/json",
      };
      const noKeys = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects:batchDelete`, {
          method: "POST", headers, body: JSON.stringify({}),
        }),
      );
      expect(noKeys.status).toBe(400);

      const tooMany = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects:batchDelete`, {
          method: "POST", headers,
          body: JSON.stringify({ keys: Array.from({ length: 1001 }, (_, i) => `k${i}`) }),
        }),
      );
      expect(tooMany.status).toBe(400);
    } finally {
      setup.cleanup();
    }
  });
});
