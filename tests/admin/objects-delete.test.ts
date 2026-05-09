import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("DELETE /_admin/buckets/:b/objects/*key", () => {
  test("deletes existing object → 204", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const headers = { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG };
      await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/x.txt`, {
          method: "PUT",
          headers: { ...headers, "Content-Length": "1" },
          body: "x",
        }),
      );
      const del = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/x.txt`, {
          method: "DELETE", headers,
        }),
      );
      expect(del.status).toBe(204);

      const get = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/x.txt`, { headers }),
      );
      expect(get.status).toBe(404);
    } finally {
      setup.cleanup();
    }
  });

  test("delete missing key → 204 (idempotent)", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/never-existed.txt`, {
          method: "DELETE",
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(res.status).toBe(204);
    } finally {
      setup.cleanup();
    }
  });
});
