import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("GET /_admin/buckets/:b/objects/*key", () => {
  test("downloads previously uploaded object (full body)", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const body = "drime-payload-1234567890";
      const put = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/file.bin`, {
          method: "PUT",
          headers: {
            Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG,
            "Content-Length": String(body.length),
          },
          body,
        }),
      );
      expect(put.status).toBe(200);

      const get = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/file.bin`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(get.status).toBe(200);
      expect(await get.text()).toBe(body);
    } finally {
      setup.cleanup();
    }
  });

  test("404 when key missing", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/missing.txt`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(res.status).toBe(404);
    } finally {
      setup.cleanup();
    }
  });
});
