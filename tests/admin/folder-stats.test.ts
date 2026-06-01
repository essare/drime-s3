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

describe("POST /_admin/buckets/:b/folder-stats", () => {
  test("returns aggregated size and object count for visible prefixes", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      await putViaS3(setup, "docs", "sub/a.txt", "aaa");
      await putViaS3(setup, "docs", "sub/b.txt", "bb");
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folder-stats`, {
          method: "POST",
          headers: { ...H(cookie), "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: ["sub/"] }),
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as {
        stats: {
          prefix: string;
          size: number;
          objectCount: number;
          lastModified: string | null;
        }[];
      };
      expect(j.stats).toHaveLength(1);
      expect(j.stats[0]?.prefix).toBe("sub/");
      expect(j.stats[0]?.size).toBe(5);
      expect(j.stats[0]?.objectCount).toBeNull();
      expect(typeof j.stats[0]?.lastModified).toBe("string");
      expect(j.stats[0]?.lastModified).not.toBe("1970-01-01T00:00:00.000Z");
    } finally {
      setup.cleanup();
    }
  });

  test("rejects more than 10 prefixes", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const prefixes = Array.from({ length: 11 }, (_, i) => `p${i}/`);
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folder-stats`, {
          method: "POST",
          headers: { ...H(cookie), "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes }),
        }),
      );
      expect(res.status).toBe(400);
    } finally {
      setup.cleanup();
    }
  });
});
