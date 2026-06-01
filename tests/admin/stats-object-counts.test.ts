import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";
function authedHeaders(cookie: string): HeadersInit {
  return {
    Host: "127.0.0.1:8081",
    Cookie: cookie,
    Origin: ORIG,
    "Content-Type": "application/json",
  };
}

type ObjectCountsResponse = {
  totalObjects: number;
  perBucket: { name: string; objects: number }[];
};

async function uploadObject(
  setup: Awaited<ReturnType<typeof startAdmin>>,
  cookie: string,
  bucket: string,
  key: string,
  body: string,
): Promise<void> {
  const url = `${ORIG}/_admin/buckets/${bucket}/objects/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const res = await setup.call(
    new Request(url, {
      method: "PUT",
      headers: {
        Host: "127.0.0.1:8081",
        Cookie: cookie,
        Origin: ORIG,
      },
      body: body as BodyInit,
    }),
  );
  if (res.status !== 200) {
    throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  }
}

describe("GET /_admin/stats/object-counts", () => {
  test("empty workspace returns zero counts", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/stats/object-counts`, {
          headers: authedHeaders(cookie),
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as ObjectCountsResponse;
      expect(j).toEqual({ totalObjects: 0, perBucket: [] });
    } finally {
      setup.cleanup();
    }
  });

  test("walks buckets and returns object counts", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["alpha", "beta", "gamma"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      await uploadObject(setup, cookie, "alpha", "a.txt", "12345");
      await uploadObject(setup, cookie, "alpha", "deep/b.txt", "abcdefghij");
      await uploadObject(setup, cookie, "beta", "only.txt", "x");

      const res = await setup.call(
        new Request(`${ORIG}/_admin/stats/object-counts`, {
          headers: authedHeaders(cookie),
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as ObjectCountsResponse;
      expect(j.totalObjects).toBe(3);
      const byName = new Map(j.perBucket.map((b) => [b.name, b]));
      expect(byName.get("alpha")?.objects).toBe(2);
      expect(byName.get("beta")?.objects).toBe(1);
      expect(byName.get("gamma")?.objects).toBe(0);
    } finally {
      setup.cleanup();
    }
  });

  test("requires authentication (401 without cookie)", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(
        new Request(`${ORIG}/_admin/stats/object-counts`, {
          headers: { Host: "127.0.0.1:8081", Origin: ORIG },
        }),
      );
      expect(res.status).toBe(401);
    } finally {
      setup.cleanup();
    }
  });
});
