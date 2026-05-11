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

  test("creates a folder under a sub-prefix", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      // First create reports/ at the root.
      let r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "reports" }),
        }),
      );
      expect(r.status).toBe(201);
      r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders?prefix=reports`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "q1" }),
        }),
      );
      expect(r.status).toBe(201);
      const j = (await r.json()) as { name: string; prefix: string };
      expect(j).toEqual({ name: "q1", prefix: "reports/q1/" });
    } finally {
      setup.cleanup();
    }
  });

  test("409 FolderAlreadyExists on duplicate folder", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "reports" }),
        }),
      );
      const r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "REPORTS" }),
        }),
      );
      expect(r.status).toBe(409);
      const j = (await r.json()) as {
        error: { code: string; details?: { existingKind?: string } };
      };
      expect(j.error.code).toBe("FolderAlreadyExists");
      expect(j.error.details?.existingKind).toBe("folder");
    } finally {
      setup.cleanup();
    }
  });

  test("409 FolderAlreadyExists when an object with the same name exists", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      // Upload an object named "notes" at the root via S3 path.
      await setup.call(
        new Request(`${ORIG}/docs/notes`, {
          method: "PUT",
          headers: { Host: "127.0.0.1:8081", "Content-Length": "5" },
          body: "hello",
        }),
      );
      const r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "notes" }),
        }),
      );
      expect(r.status).toBe(409);
      const j = (await r.json()) as {
        error: { details?: { existingKind?: string } };
      };
      expect(j.error.details?.existingKind).toBe("file");
    } finally {
      setup.cleanup();
    }
  });

  test("400 BadRequest on missing/empty/whitespace path", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      for (const body of [
        JSON.stringify({}),
        JSON.stringify({ path: "" }),
        JSON.stringify({ path: "   " }),
      ]) {
        const r = await setup.call(
          new Request(`${ORIG}/_admin/buckets/docs/folders`, {
            method: "POST",
            headers: H(cookie),
            body,
          }),
        );
        expect(r.status).toBe(400);
      }
    } finally {
      setup.cleanup();
    }
  });

  test("400 BadRequest on illegal characters or reserved names", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const bad = [
        "a/b",
        "a\\b",
        ".",
        "..",
        "x\x00y",
        "x\x7fy",
        "x".repeat(256),
      ];
      for (const path of bad) {
        const r = await setup.call(
          new Request(`${ORIG}/_admin/buckets/docs/folders`, {
            method: "POST",
            headers: H(cookie),
            body: JSON.stringify({ path }),
          }),
        );
        expect(r.status).toBe(400);
      }
    } finally {
      setup.cleanup();
    }
  });

  test("404 NoSuchBucket when bucket does not exist", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/nope/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "x" }),
        }),
      );
      expect(r.status).toBe(404);
      const j = (await r.json()) as { error: { code: string } };
      expect(j.error.code).toBe("NoSuchBucket");
    } finally {
      setup.cleanup();
    }
  });

  test("404 NoSuchPrefix when parent prefix does not exist", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const r = await setup.call(
        new Request(
          `${ORIG}/_admin/buckets/docs/folders?prefix=does/not/exist`,
          {
            method: "POST",
            headers: H(cookie),
            body: JSON.stringify({ path: "x" }),
          },
        ),
      );
      expect(r.status).toBe(404);
      const j = (await r.json()) as { error: { code: string } };
      expect(j.error.code).toBe("NoSuchPrefix");
    } finally {
      setup.cleanup();
    }
  });

  test("401 Unauthorized without cookie", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: {
            Host: "127.0.0.1:8081",
            Origin: ORIG,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: "x" }),
        }),
      );
      expect(r.status).toBe(401);
    } finally {
      setup.cleanup();
    }
  });

  test("403 cross-origin POST is rejected", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: {
            Host: "127.0.0.1:8081",
            Cookie: cookie,
            Origin: "http://evil.example.com",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: "x" }),
        }),
      );
      expect(r.status).toBe(403);
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
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "x" }),
        }),
      );
      expect(res.status).toBe(503);
      const j = (await res.json()) as { error: { code: string } };
      expect(j.error.code).toBe("WorkspaceUnavailable");
    } finally {
      setup.cleanup();
    }
  });

  test("400 BadRequest on malformed JSON body", async () => {
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
          body: "not json",
        }),
      );
      expect(res.status).toBe(400);
      const j = (await res.json()) as { error: { code: string } };
      expect(j.error.code).toBe("BadRequest");
    } finally {
      setup.cleanup();
    }
  });

  test("read-your-writes: listing immediately after create includes the new folder", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const create = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "fresh" }),
        }),
      );
      expect(create.status).toBe(201);
      const list = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects?delimiter=/&prefix=`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      const lj = (await list.json()) as { commonPrefixes: string[] };
      expect(lj.commonPrefixes).toContain("fresh/");
    } finally {
      setup.cleanup();
    }
  });
});
