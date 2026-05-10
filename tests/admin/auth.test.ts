import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

function loginReq(body: unknown, ip = "1.2.3.4"): Request {
  return new Request("http://127.0.0.1:8081/_admin/login", {
    method: "POST",
    headers: {
      Host: "127.0.0.1:8081",
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /_admin/login", () => {
  test("happy path returns 200 + Set-Cookie with HttpOnly SameSite=Strict", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(loginReq({ password: "hunter2-hunter2" }));
      expect(res.status).toBe(200);
      const j = (await res.json()) as { authenticated: boolean };
      expect(j.authenticated).toBe(true);
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("drime_admin=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Path=/_admin/");
    } finally {
      setup.cleanup();
    }
  });

  test("wrong password returns 401 Unauthorized", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(loginReq({ password: "wrong" }));
      expect(res.status).toBe(401);
      const j = (await res.json()) as { error: { code: string } };
      expect(j.error.code).toBe("Unauthorized");
      expect(res.headers.get("set-cookie")).toBeNull();
    } finally {
      setup.cleanup();
    }
  });

  test("malformed body returns 400 BadRequest", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/login", {
          method: "POST",
          headers: {
            Host: "127.0.0.1:8081",
            "Content-Type": "application/json",
          },
          body: "not-json",
        }),
      );
      expect(res.status).toBe(400);
    } finally {
      setup.cleanup();
    }
  });

  test("after 5 wrong attempts the 6th returns 429 with Retry-After", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      for (let i = 0; i < 5; i++) {
        const r = await setup.call(loginReq({ password: "wrong" }, "9.9.9.9"));
        expect(r.status).toBe(401);
      }
      const r6 = await setup.call(loginReq({ password: "wrong" }, "9.9.9.9"));
      expect(r6.status).toBe(429);
      expect(Number(r6.headers.get("Retry-After") ?? 0)).toBeGreaterThan(0);
    } finally {
      setup.cleanup();
    }
  });

  test("503 AdminDisabled when WEB_UI_PASSWORD unset", async () => {
    const setup = await startAdmin({ password: "" });
    try {
      const res = await setup.call(loginReq({ password: "x" }));
      expect(res.status).toBe(503);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("AdminDisabled");
    } finally {
      setup.cleanup();
    }
  });
});

describe("/_admin/logout and /_admin/session", () => {
  test("GET /_admin/session without cookie → { authenticated: false }", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/session", {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { authenticated: boolean };
      expect(j.authenticated).toBe(false);
    } finally {
      setup.cleanup();
    }
  });

  test("GET /_admin/session with valid cookie → authenticated:true and expiresAt", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/session", {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie },
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as {
        authenticated: boolean;
        expiresAt: string;
      };
      expect(j.authenticated).toBe(true);
      expect(typeof j.expiresAt).toBe("string");
    } finally {
      setup.cleanup();
    }
  });

  test("POST /_admin/logout returns 204 and Max-Age=0 cookie (idempotent)", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/logout", {
          method: "POST",
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
    } finally {
      setup.cleanup();
    }
  });
});

describe("admin/origin enforcement", () => {
  test("/_admin/session with mismatched Origin returns 403", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/session", {
          headers: {
            Host: "127.0.0.1:8081",
            Cookie: cookie,
            Origin: "http://evil.example",
          },
        }),
      );
      expect(res.status).toBe(403);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("Forbidden");
    } finally {
      setup.cleanup();
    }
  });

  test("/_admin/session with matching Origin works", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/session", {
          headers: {
            Host: "127.0.0.1:8081",
            Cookie: cookie,
            Origin: "http://127.0.0.1:8081",
          },
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      setup.cleanup();
    }
  });
});
