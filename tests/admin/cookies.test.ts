import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { signSessionToken, verifySessionToken, parseCookieHeader, buildSetCookie } from "../../src/admin/cookies";

const secret = new Uint8Array(Buffer.from("a".repeat(64), "hex")); // 32 bytes

describe("admin/cookies", () => {
  test("signSessionToken / verifySessionToken roundtrip", async () => {
    const t = await signSessionToken({ ttlMs: 60_000 }, secret);
    const v = await verifySessionToken(t, secret, Date.now());
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(typeof v.payload.iat).toBe("number");
      expect(typeof v.payload.exp).toBe("number");
    }
  });

  test("verifySessionToken rejects expired token", async () => {
    const t = await signSessionToken({ ttlMs: 1 }, secret);
    const v = await verifySessionToken(t, secret, Date.now() + 10);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("expired");
  });

  test("verifySessionToken rejects tampered token", async () => {
    const t = await signSessionToken({ ttlMs: 60_000 }, secret);
    const tampered = `${t.slice(0, -2)}AA`;
    const v = await verifySessionToken(tampered, secret, Date.now());
    expect(v.ok).toBe(false);
  });

  test("verifySessionToken rejects malformed tokens (no separator or empty halves)", async () => {
    for (const t of ["nodot", ".onlymac", "onlypayload."]) {
      const v = await verifySessionToken(t, secret, Date.now());
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toBe("malformed");
    }
  });

  test("verifySessionToken rejects future-version (v:2) token even with valid MAC", async () => {
    const payload = Buffer.from(
      JSON.stringify({ iat: Date.now(), exp: Date.now() + 60_000, v: 2 }),
      "utf8",
    ).toString("base64url");
    const mac = createHmac("sha256", Buffer.from(secret))
      .update(payload)
      .digest()
      .toString("base64url");
    const v = await verifySessionToken(`${payload}.${mac}`, secret, Date.now());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("malformed");
  });

  test("parseCookieHeader extracts named cookie", () => {
    expect(parseCookieHeader("a=1; drime_admin=xyz; b=2", "drime_admin")).toBe("xyz");
    expect(parseCookieHeader(null, "drime_admin")).toBeNull();
    expect(parseCookieHeader("", "drime_admin")).toBeNull();
  });

  test("parseCookieHeader matches cookie name exactly (no prefix or suffix collision)", () => {
    // Prefix collision: name appears as suffix of another cookie name
    expect(parseCookieHeader("xdrime_admin=foo", "drime_admin")).toBeNull();
    // Suffix collision: name is a prefix of another cookie name; must skip and find the real one
    expect(
      parseCookieHeader("drime_admin_x=wrong; drime_admin=correct", "drime_admin"),
    ).toBe("correct");
  });

  test("buildSetCookie produces HttpOnly SameSite=Strict cookie", () => {
    const v = buildSetCookie("drime_admin", "abc", { ttlSec: 3600, secure: true });
    expect(v).toContain("drime_admin=abc");
    expect(v).toContain("HttpOnly");
    expect(v).toContain("SameSite=Strict");
    expect(v).toContain("Path=/_admin/");
    expect(v).toContain("Max-Age=3600");
    expect(v).toContain("Secure");
  });

  test("buildSetCookie omits Secure when secure=false", () => {
    const v = buildSetCookie("drime_admin", "abc", { ttlSec: 3600, secure: false });
    expect(v).not.toContain("Secure");
  });

  test("buildSetCookie('', { expire: true }) issues a deletion cookie", () => {
    const v = buildSetCookie("drime_admin", "", { expire: true, secure: false });
    expect(v).toContain("Max-Age=0");
  });
});
