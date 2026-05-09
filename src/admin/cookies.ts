import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionPayload = {
  iat: number; // epoch ms
  exp: number; // epoch ms
  v: 1;
};

export type VerifyResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: "malformed" | "bad-mac" | "expired" };

function b64urlEncode(buf: Uint8Array | Buffer): string {
  return Buffer.from(buf).toString("base64url");
}
function b64urlDecode(str: string): Buffer | null {
  try {
    return Buffer.from(str, "base64url");
  } catch {
    return null;
  }
}

function hmac(secret: Uint8Array, data: string): Buffer {
  return createHmac("sha256", Buffer.from(secret)).update(data).digest();
}

export async function signSessionToken(
  opts: { ttlMs: number; now?: number },
  secret: Uint8Array,
): Promise<string> {
  const now = opts.now ?? Date.now();
  const payload: SessionPayload = { iat: now, exp: now + opts.ttlMs, v: 1 };
  const payloadStr = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = hmac(secret, payloadStr);
  return `${payloadStr}.${b64urlEncode(mac)}`;
}

export async function verifySessionToken(
  token: string,
  secret: Uint8Array,
  nowMs: number,
): Promise<VerifyResult> {
  const i = token.indexOf(".");
  if (i <= 0 || i === token.length - 1)
    return { ok: false, reason: "malformed" };
  const payloadStr = token.slice(0, i);
  const macStr = token.slice(i + 1);

  const provided = b64urlDecode(macStr);
  const expected = hmac(secret, payloadStr);
  if (!provided || provided.length !== expected.length) {
    return { ok: false, reason: "bad-mac" };
  }
  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad-mac" };
  }

  const raw = b64urlDecode(payloadStr);
  if (!raw) return { ok: false, reason: "malformed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as SessionPayload).iat !== "number" ||
    typeof (parsed as SessionPayload).exp !== "number" ||
    (parsed as SessionPayload).v !== 1
  ) {
    return { ok: false, reason: "malformed" };
  }
  const payload = parsed as SessionPayload;
  if (payload.exp <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

export function parseCookieHeader(
  header: string | null,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

export function buildSetCookie(
  name: string,
  value: string,
  opts: { ttlSec?: number; secure: boolean; expire?: boolean },
): string {
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/_admin/",
  ];
  if (opts.expire) parts.push("Max-Age=0");
  else if (typeof opts.ttlSec === "number")
    parts.push(`Max-Age=${opts.ttlSec}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}
