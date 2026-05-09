import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import type { AppContext } from "../server-context";
import { parseCookieHeader, verifySessionToken } from "./cookies";
import { jsonError } from "./errors";

const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export type LoginAttempt = { count: number; firstAttemptMs: number };

export function verifyPassword(configured: string, provided: string): boolean {
  if (configured.length === 0) return false;
  const a = Buffer.from(configured, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) {
    // Dummy compare on equal-length buffers to keep timing roughly constant.
    const x = Buffer.alloc(Math.max(a.length, 1), 0x00);
    const y = Buffer.alloc(x.length, 0xff);
    timingSafeEqual(x, y);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function checkAndRecordLoginAttempt(
  map: Map<string, LoginAttempt>,
  ip: string,
  nowMs: number,
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const rec = map.get(ip);
  if (!rec || nowMs - rec.firstAttemptMs > WINDOW_MS) {
    pruneExpiredAttempts(map, nowMs);
    map.set(ip, { count: 1, firstAttemptMs: nowMs });
    return { allowed: true };
  }
  if (rec.count < MAX_ATTEMPTS) {
    rec.count += 1;
    return { allowed: true };
  }
  const retryAfterSec = Math.max(
    1,
    Math.ceil((rec.firstAttemptMs + WINDOW_MS - nowMs) / 1000),
  );
  return { allowed: false, retryAfterSec };
}

/** Drops entries whose 5-minute window has fully elapsed. Called from check() lazily. */
function pruneExpiredAttempts(
  map: Map<string, LoginAttempt>,
  nowMs: number,
): void {
  for (const [ip, rec] of map) {
    if (nowMs - rec.firstAttemptMs > WINDOW_MS) {
      map.delete(ip);
    }
  }
}

/**
 * Same-origin enforcement: when `Origin` is present, it must equal `http(s)://<host>`.
 * Used for state-changing /_admin/* requests (cookie + Origin pin = no CSRF).
 */
export function checkOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  const host = req.headers.get("host") ?? "";
  // Allow http and https of the same host:port.
  const expected = new Set([`http://${host}`, `https://${host}`]);
  if (expected.has(origin)) return null;
  return jsonError("Forbidden", "Cross-origin request blocked.", 403);
}

export async function requireSession(
  ctx: AppContext,
  req: Request,
): Promise<Response | null> {
  const raw = parseCookieHeader(req.headers.get("cookie"), "drime_admin");
  if (!raw) return jsonError("Unauthorized", "Login required.", 401);
  const v = await verifySessionToken(raw, ctx.webUi.sessionSecret, Date.now());
  if (!v.ok) return jsonError("Unauthorized", "Session invalid or expired.", 401);
  return null;
}
