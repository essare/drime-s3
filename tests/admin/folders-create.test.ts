import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";
function H(cookie: string) {
  return {
    Host: "127.0.0.1:8081",
    Cookie: cookie,
    Origin: ORIG,
    "Content-Type": "application/json",
  };
}

describe("POST /_admin/buckets/:b/folders", () => {
  test("creates a folder at the bucket root", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "reports" }),
        }),
      );
      expect(res.status).toBe(201);
      const j = (await res.json()) as { name: string; prefix: string };
      expect(j).toEqual({ name: "reports", prefix: "reports/" });

      const listed = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects?delimiter=/&prefix=`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      const lj = (await listed.json()) as { commonPrefixes: string[] };
      expect(lj.commonPrefixes).toContain("reports/");
    } finally {
      setup.cleanup();
    }
  });
});
