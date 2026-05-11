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

type StatsResponse = {
  buckets: number;
  totalBytes: number;
  totalObjects: number;
  perBucket: { name: string; bytes: number; objects: number }[];
};

async function uploadObject(
  setup: Awaited<ReturnType<typeof startAdmin>>,
  cookie: string,
  bucket: string,
  key: string,
  body: string | Uint8Array,
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

describe("/_admin/stats", () => {
  test("empty workspace returns zero counts", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/stats`, {
          headers: authedHeaders(cookie),
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as StatsResponse;
      expect(j).toEqual({
        buckets: 0,
        totalBytes: 0,
        totalObjects: 0,
        perBucket: [],
      });
    } finally {
      setup.cleanup();
    }
  });

  test("multiple buckets with seeded objects sum correctly", async () => {
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
        new Request(`${ORIG}/_admin/stats`, {
          headers: authedHeaders(cookie),
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as StatsResponse;
      expect(j.buckets).toBe(3);
      expect(j.totalObjects).toBe(3);
      expect(j.totalBytes).toBe(5 + 10 + 1);

      const byName = new Map(j.perBucket.map((b) => [b.name, b]));
      expect(byName.get("alpha")).toEqual({
        name: "alpha",
        bytes: 15,
        objects: 2,
      });
      expect(byName.get("beta")).toEqual({
        name: "beta",
        bytes: 1,
        objects: 1,
      });
      expect(byName.get("gamma")).toEqual({
        name: "gamma",
        bytes: 0,
        objects: 0,
      });
      // perBucket is sorted alphabetically.
      expect(j.perBucket.map((b) => b.name)).toEqual([
        "alpha",
        "beta",
        "gamma",
      ]);
    } finally {
      setup.cleanup();
    }
  });

  test("requires authentication (401 without cookie)", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(
        new Request(`${ORIG}/_admin/stats`, {
          headers: { Host: "127.0.0.1:8081", Origin: ORIG },
        }),
      );
      expect(res.status).toBe(401);
    } finally {
      setup.cleanup();
    }
  });

  test("returns 503 WorkspaceUnavailable when workspace not initialized", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      gatewayWorkspaceName: "does-not-exist",
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/stats`, {
          headers: authedHeaders(cookie),
        }),
      );
      expect(res.status).toBe(503);
      const j = (await res.json()) as { error: { code: string } };
      expect(j.error.code).toBe("WorkspaceUnavailable");
    } finally {
      setup.cleanup();
    }
  });
});
