import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { startAdmin } from "./helpers";

describe("admin/dispatch (front-of-line)", () => {
  test("AWS Sig V4 GET / still returns ListAllMyBuckets XML", async () => {
    const setup = await startAdmin({ seedRootFolders: ["my-bucket"] });
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/", {
          headers: {
            Host: "127.0.0.1:8081",
            Authorization: "AWS4-HMAC-SHA256 Credential=AKIATEST/...",
          },
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/xml");
      const xml = await res.text();
      expect(xml).toContain("ListAllMyBucketsResult");
    } finally {
      setup.cleanup();
    }
  });

  test("Browser GET / (Accept: text/html, no AWS auth) → 302 /_ui/", async () => {
    const setup = await startAdmin();
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/", {
          headers: {
            Host: "127.0.0.1:8081",
            Accept: "text/html,application/xhtml+xml",
          },
        }),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/_ui/");
    } finally {
      setup.cleanup();
    }
  });

  test("/_admin/health is reachable without Sig V4 auth (insecure=false)", async () => {
    const setup = await startAdmin({
      config: { insecure: false } as never, // override default
    } as never);
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/health", {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect([200, 404]).toContain(res.status); // 404 until Task 9
      // Critically: NOT 403 (Sig V4 must not gate /_admin/*)
      expect(res.status).not.toBe(403);
    } finally {
      setup.cleanup();
    }
  });

  test("/_ui/index.html is served when web/dist exists, otherwise 404", async () => {
    const setup = await startAdmin();
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_ui/index.html", {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      const distIndex = path.resolve(
        import.meta.dir,
        "..",
        "..",
        "web",
        "dist",
        "index.html",
      );
      const hasDist = existsSync(distIndex);
      if (hasDist) {
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toContain("text/html");
      } else {
        expect(res.status).toBe(404);
      }
      expect([403, 500]).not.toContain(res.status);
    } finally {
      setup.cleanup();
    }
  });

  test("AWS Sig V4 + Accept: text/html on GET / still routes to ListAllMyBuckets, not 302", async () => {
    const setup = await startAdmin({ seedRootFolders: ["my-bucket"] });
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/", {
          headers: {
            Host: "127.0.0.1:8081",
            Accept: "text/html,application/xhtml+xml",
            Authorization: "AWS4-HMAC-SHA256 Credential=AKIATEST/...",
          },
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/xml");
    } finally {
      setup.cleanup();
    }
  });

  test("Presigned URL GET / (lowercase x-amz-signature) is not redirected to /_ui/", async () => {
    const setup = await startAdmin();
    try {
      const res = await setup.call(
        new Request(
          "http://127.0.0.1:8081/?x-amz-algorithm=AWS4-HMAC-SHA256&x-amz-signature=abc123&x-amz-credential=AKIATEST",
          { headers: { Host: "127.0.0.1:8081", Accept: "text/html" } },
        ),
      );
      // Whatever the eventual auth verdict is, we MUST NOT 302-redirect a presigned request.
      expect(res.status).not.toBe(302);
    } finally {
      setup.cleanup();
    }
  });

  test("/_admin without trailing slash falls through to S3 dispatch (does not match /_admin/* prefix)", async () => {
    const setup = await startAdmin();
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin", {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      // Treated as a bucket path "_admin" — should be 4xx (not the admin 404 JSON envelope, and not 200/302).
      expect([400, 401, 403, 404]).toContain(res.status);
    } finally {
      setup.cleanup();
    }
  });
});
