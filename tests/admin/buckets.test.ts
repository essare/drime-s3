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

describe("/_admin/buckets", () => {
  test("GET lists existing root folders as buckets with createdAt", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["alpha", "beta"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets`, {
          headers: authedHeaders(cookie),
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as {
        buckets: { name: string; createdAt: string }[];
        count: number;
      };
      expect(j.count).toBe(2);
      expect(j.buckets.map((b) => b.name).sort()).toEqual(["alpha", "beta"]);
      for (const b of j.buckets) expect(typeof b.createdAt).toBe("string");
    } finally {
      setup.cleanup();
    }
  });

  test("POST creates a bucket; second POST returns 409 BucketAlreadyExists", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const a = await setup.call(
        new Request(`${ORIG}/_admin/buckets`, {
          method: "POST",
          headers: authedHeaders(cookie),
          body: JSON.stringify({ name: "newbucket" }),
        }),
      );
      expect(a.status).toBe(201);

      const b = await setup.call(
        new Request(`${ORIG}/_admin/buckets`, {
          method: "POST",
          headers: authedHeaders(cookie),
          body: JSON.stringify({ name: "newbucket" }),
        }),
      );
      expect(b.status).toBe(409);
      const j = (await b.json()) as { error: { code: string } };
      expect(j.error.code).toBe("BucketAlreadyExists");
    } finally {
      setup.cleanup();
    }
  });

  test("POST with invalid name → 400 InvalidBucketName", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets`, {
          method: "POST",
          headers: authedHeaders(cookie),
          body: JSON.stringify({ name: "ALL_CAPS_NOT_ALLOWED" }),
        }),
      );
      expect(res.status).toBe(400);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("InvalidBucketName");
    } finally {
      setup.cleanup();
    }
  });

  test("DELETE empty bucket → 204; DELETE missing bucket → 404", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["to-delete"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const ok = await setup.call(
        new Request(`${ORIG}/_admin/buckets/to-delete`, {
          method: "DELETE",
          headers: authedHeaders(cookie),
        }),
      );
      expect(ok.status).toBe(204);
      const missing = await setup.call(
        new Request(`${ORIG}/_admin/buckets/missing`, {
          method: "DELETE",
          headers: authedHeaders(cookie),
        }),
      );
      expect(missing.status).toBe(404);
    } finally {
      setup.cleanup();
    }
  });
});
