import type { AppContext } from "../../server-context";
import { checkAndRecordLoginAttempt, verifyPassword } from "../auth";
import { buildSetCookie, signSessionToken } from "../cookies";
import { jsonError, jsonOk } from "../errors";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

function isHttps(req: Request, url: URL): boolean {
  if (url.protocol === "https:") return true;
  return req.headers.get("x-forwarded-proto")?.toLowerCase() === "https";
}

export async function handleLogin(
  ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  const ip = clientIp(req);

  const gate = checkAndRecordLoginAttempt(ctx.webUi.loginAttempts, ip, Date.now());
  if (!gate.allowed) {
    return jsonError(
      "RateLimited",
      "Too many login attempts; try again later.",
      429,
      { retryAfter: gate.retryAfterSec },
      { "Retry-After": String(gate.retryAfterSec) },
    );
  }

  let body: { password?: unknown };
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return jsonError("BadRequest", "Body must be JSON.", 400);
  }
  const provided = typeof body.password === "string" ? body.password : "";

  if (!verifyPassword(ctx.webUi.password, provided)) {
    return jsonError("Unauthorized", "Invalid password.", 401);
  }

  const token = await signSessionToken(
    { ttlMs: SESSION_TTL_MS },
    ctx.webUi.sessionSecret,
  );
  ctx.webUi.recordSessionIssued();

  const cookie = buildSetCookie("drime_admin", token, {
    ttlSec: Math.floor(SESSION_TTL_MS / 1000),
    secure: isHttps(req, url),
  });

  const res = jsonOk({ authenticated: true, expiresInSec: SESSION_TTL_MS / 1000 });
  res.headers.append("Set-Cookie", cookie);
  return res;
}
