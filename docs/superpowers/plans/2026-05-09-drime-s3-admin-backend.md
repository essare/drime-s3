# drime-s3 Admin Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/_admin/*` JSON control-plane API on top of the existing Bun gateway, with `WEB_UI_PASSWORD`-based cookie auth, the dispatch split that separates browser/UI/S3 traffic, and JSON wrappers around all bucket and object operations. Produces a working API exercisable with `curl`; frontend (Plan B) consumes it later.

**Architecture:** New `src/admin/` module hosts the control-plane router, auth, and handlers. Front-of-line dispatch in `src/server.ts` splits requests into `/_admin/*` (cookie-authed JSON), `/_ui/*` (static SPA — stub for now), and the existing S3 surface. Admin handlers reuse existing S3 logic via shared bridge functions in `src/admin/shared.ts` so behavior never diverges between the JSON and XML paths.

**Tech Stack:** Bun + TypeScript, `bun:test`, pino, existing `DrimeClient` and S3 handlers, `crypto.subtle` (HMAC-SHA256, HKDF) and `crypto.timingSafeEqual` from `node:crypto`. No new runtime dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-09-drime-s3-frontend-design.md`](../specs/2026-05-09-drime-s3-frontend-design.md). This plan implements §3.1–3.6, §4, §5, §9, and the backend portions of §10–11.

---

## File Structure

| File | Purpose |
|---|---|
| `src/config.ts` *(modify)* | Add `webUi.password` (string) and `webUi.sessionSecret` (Buffer) loaders from env. |
| `src/server-context.ts` *(modify)* | Add `webUi` block to `AppContext`: resolved password, session secret, in-memory rate-limit map, active-session counter. |
| `src/admin/router.ts` *(create)* | `/_admin/*` dispatch — routes to handlers, applies cookie auth and Origin checks. |
| `src/admin/auth.ts` *(create)* | Password compare (constant-time), cookie sign/verify (HMAC-SHA256), per-IP token-bucket rate limiter. |
| `src/admin/cookies.ts` *(create)* | Read/write `Set-Cookie` and `Cookie` headers. |
| `src/admin/errors.ts` *(create)* | JSON error envelope helper. |
| `src/admin/handlers/health.ts` *(create)* | Public `/_admin/health`. |
| `src/admin/handlers/session.ts` *(create)* | `POST /login`, `POST /logout`, `GET /session`. |
| `src/admin/handlers/status.ts` *(create)* | `GET /status` — env / drime / workspace. |
| `src/admin/handlers/init.ts` *(create)* | `POST /init` — wraps `runInit`. |
| `src/admin/handlers/buckets.ts` *(create)* | `GET/POST /buckets`, `DELETE /buckets/:bucket`. |
| `src/admin/handlers/objects.ts` *(create)* | `GET/PUT/DELETE /buckets/:bucket/objects/*key`, `POST :batchDelete`. |
| `src/admin/shared.ts` *(create)* | Bridge functions reused by admin handlers (delegate to existing S3 logic). |
| `src/admin/ui-assets.ts` *(create)* | Stub that returns 404 in Plan A; replaced in Plan B. |
| `src/s3/handlers/list-objects.ts` *(modify)* | Refactor: extract pure listing helper returning the `JsonListing` shape; existing XML handler wraps it. |
| `src/s3/router.ts` *(modify)* | Front-of-line dispatch: detect browser hits to `/`, route `/_admin/*` and `/_ui/*` before Sig V4. |
| `src/cli/main.ts` *(modify)* | Startup warning when `WEB_UI_PASSWORD` is unset. |
| `tests/admin/helpers.ts` *(create)* | Shared `testConfig`, `startContext`, `loginAndGetCookie` helpers. |
| `tests/admin/auth.test.ts` *(create)* | Login/logout/cookie/rate-limit. |
| `tests/admin/dispatch.test.ts` *(create)* | Browser vs S3 routing at `/`. |
| `tests/admin/health.test.ts` *(create)* | Public `/_admin/health` shape. |
| `tests/admin/status.test.ts` *(create)* | `/status` env/drime/workspace matrix. |
| `tests/admin/init.test.ts` *(create)* | Workspace bootstrap idempotent. |
| `tests/admin/buckets.test.ts` *(create)* | List/create/delete + 409 on duplicate / non-empty. |
| `tests/admin/objects.test.ts` *(create)* | List/upload/download/delete/batchDelete via JSON. |
| `tests/integration/router-health.test.ts` *(modify)* | Adjust expectations for the new `webUi` block. |
| `tests/fixtures/mock-drime/server.ts` *(modify, minimal)* | If needed: ensure idempotent workspace create works for `init` test. |

## How to run things

- Tests: `bun test path/to/file.test.ts` (single) · `bun test` (full suite).
- Typecheck: `bun run typecheck`.
- Lint: `bun run lint`.
- Manual API check: in one terminal `bun run dev`, in another `curl -i http://127.0.0.1:8081/_admin/health`.

## Conventions used by this plan

- All admin responses set `Cache-Control: no-store` and `Content-Type: application/json` (or stream-appropriate type).
- Error envelope: `{ "error": { "code": "<S3-style-or-Admin-code>", "message": "...", "details"?: {...} } }`.
- Test logger: `pino({ level: "silent" })`.
- New tests live under `tests/admin/`; existing `tests/integration/` files are only modified when the dispatch change forces it.
- Commit prefix: `feat(admin):` for new behavior, `refactor(s3):` for handler refactors, `test(admin):` for test-only commits, `chore(config):` for config additions.

---

<!-- TASKS-START -->

### Task 1: Add `webUi` config keys

Goal: load `WEB_UI_PASSWORD` and (optional) `WEB_UI_SESSION_SECRET` into `AppConfig`.

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/unit/config.test.ts`

- [ ] **Step 1: Write failing test for env loading**

Add to `tests/unit/config.test.ts`:

```ts
test("loadConfig reads WEB_UI_PASSWORD and WEB_UI_SESSION_SECRET from env", async () => {
  const prev = {
    pwd: process.env.WEB_UI_PASSWORD,
    sec: process.env.WEB_UI_SESSION_SECRET,
    insecure: process.env.DRIME_S3_INSECURE,
  };
  process.env.WEB_UI_PASSWORD = "hunter2-hunter2";
  process.env.WEB_UI_SESSION_SECRET = "deadbeef".repeat(8); // 64 hex
  process.env.DRIME_S3_INSECURE = "1";
  try {
    const cfg = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(cfg.webUi.password).toBe("hunter2-hunter2");
    expect(cfg.webUi.sessionSecret).toBe("deadbeef".repeat(8));
  } finally {
    process.env.WEB_UI_PASSWORD = prev.pwd;
    process.env.WEB_UI_SESSION_SECRET = prev.sec;
    process.env.DRIME_S3_INSECURE = prev.insecure;
  }
});

test("loadConfig leaves webUi fields empty when env unset", async () => {
  const prev = {
    pwd: process.env.WEB_UI_PASSWORD,
    sec: process.env.WEB_UI_SESSION_SECRET,
    insecure: process.env.DRIME_S3_INSECURE,
  };
  delete process.env.WEB_UI_PASSWORD;
  delete process.env.WEB_UI_SESSION_SECRET;
  process.env.DRIME_S3_INSECURE = "1";
  try {
    const cfg = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(cfg.webUi.password).toBe("");
    expect(cfg.webUi.sessionSecret).toBe("");
  } finally {
    process.env.WEB_UI_PASSWORD = prev.pwd;
    process.env.WEB_UI_SESSION_SECRET = prev.sec;
    process.env.DRIME_S3_INSECURE = prev.insecure;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config.test.ts`
Expected: FAIL with "cfg.webUi" undefined.

- [ ] **Step 3: Add `WebUiConfig` type and loader**

Edit `src/config.ts`:

```ts
export type WebUiConfig = {
  password: string;
  sessionSecret: string;
};

export type AppConfig = {
  s3: S3AuthConfig;
  drime: DrimeConfig;
  server: ServerConfig;
  webUi: WebUiConfig;
  insecure: boolean;
};
```

Update `defaultConfig()` to include `webUi: { password: "", sessionSecret: "" }`.

In `applyEnv()`, add (after the existing host/port block):

```ts
const pwd = pickNonEmptyString(process.env.WEB_UI_PASSWORD);
if (pwd !== undefined) cfg.webUi.password = pwd;

const sec = pickNonEmptyString(process.env.WEB_UI_SESSION_SECRET);
if (sec !== undefined) {
  if (!/^[0-9a-fA-F]+$/.test(sec) || sec.length < 32) {
    throw new ConfigError(
      "Invalid WEB_UI_SESSION_SECRET: expected hex string with at least 32 characters (16 bytes).",
    );
  }
  cfg.webUi.sessionSecret = sec.toLowerCase();
}
```

In `applyToml()`, after the existing `[server]` block, add:

```ts
const webUi = (root as Record<string, unknown>).web_ui ?? (root as Record<string, unknown>).webUi;
if (webUi && typeof webUi === "object") {
  const w = webUi as Record<string, unknown>;
  const pwd = pickNonEmptyString(w.password);
  const sec = pickNonEmptyString(w.session_secret) ?? pickNonEmptyString(w.sessionSecret);
  if (pwd !== undefined) cfg.webUi.password = pwd;
  if (sec !== undefined) cfg.webUi.sessionSecret = sec;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/config.test.ts` → PASS.
Run: `bun run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "chore(config): add web_ui.password and web_ui.session_secret"
```

---

### Task 2: Extend `AppContext` with `webUi` runtime state

Goal: derive the session secret (from env or HKDF) at boot, hold an in-memory rate-limit map and active-session counter on the context.

**Files:**
- Create: `src/admin/state.ts`
- Modify: `src/server-context.ts`
- Test: `tests/admin/state.test.ts`

- [ ] **Step 1: Write failing test for state factory**

Create `tests/admin/state.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createWebUiState, deriveSessionSecret } from "../../src/admin/state";

describe("admin/state", () => {
  test("deriveSessionSecret uses configured hex when provided (>=16 bytes)", async () => {
    const out = await deriveSessionSecret("password", "deadbeef".repeat(8));
    expect(out.length).toBe(32); // 64 hex → 32 bytes
    expect(Buffer.from(out).toString("hex").startsWith("deadbeef")).toBe(true);
  });

  test("deriveSessionSecret falls back to HKDF(WEB_UI_PASSWORD) when secret unset", async () => {
    const out = await deriveSessionSecret("hunter2-hunter2", "");
    expect(out.length).toBe(32);
    // Same input → deterministic output
    const again = await deriveSessionSecret("hunter2-hunter2", "");
    expect(Buffer.from(out).toString("hex")).toBe(Buffer.from(again).toString("hex"));
  });

  test("deriveSessionSecret throws when both secret and password unset", async () => {
    await expect(deriveSessionSecret("", "")).rejects.toThrow(/required/i);
  });

  test("createWebUiState returns disabled state when password unset", () => {
    const s = createWebUiState({ password: "", sessionSecret: new Uint8Array(0) });
    expect(s.enabled).toBe(false);
    expect(s.activeSessions()).toBe(0);
  });

  test("createWebUiState exposes activeSessions counter", () => {
    const s = createWebUiState({ password: "p", sessionSecret: new Uint8Array(32) });
    expect(s.enabled).toBe(true);
    expect(s.activeSessions()).toBe(0);
    s.recordSessionIssued();
    expect(s.activeSessions()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`bun test tests/admin/state.test.ts`).

- [ ] **Step 3: Implement `src/admin/state.ts`**

```ts
import { hkdfSync } from "node:crypto";

export type WebUiState = {
  /** True when password is set, secret is non-empty, and the admin UI is enabled. */
  enabled: boolean;
  password: string;
  sessionSecret: Uint8Array;
  /** Per-IP login attempt records (token bucket). Pruned lazily by auth.ts. */
  loginAttempts: Map<string, { count: number; firstAttemptMs: number }>;
  recordSessionIssued: () => void;
  activeSessions: () => number;
};

const HKDF_SALT = new TextEncoder().encode("drime-s3-session-v1");
const HKDF_INFO = new TextEncoder().encode("cookie-hmac");

/**
 * Resolve the session secret as raw bytes:
 *   1. If `sessionSecretHex` is non-empty (already hex-validated by config), use it.
 *   2. Else derive HKDF-SHA256(password, salt="drime-s3-session-v1", info="cookie-hmac") → 32 bytes.
 *   3. Else (no password) → throw; caller should treat WebUiState as disabled.
 */
export async function deriveSessionSecret(
  password: string,
  sessionSecretHex: string,
): Promise<Uint8Array> {
  if (sessionSecretHex.length > 0) {
    return new Uint8Array(Buffer.from(sessionSecretHex, "hex"));
  }
  if (password.length === 0) {
    throw new Error("WEB_UI_PASSWORD or WEB_UI_SESSION_SECRET is required");
  }
  const ikm = new TextEncoder().encode(password);
  const out = hkdfSync("sha256", ikm, HKDF_SALT, HKDF_INFO, 32);
  return new Uint8Array(out);
}

export function createWebUiState(input: {
  password: string;
  sessionSecret: Uint8Array;
}): WebUiState {
  let issued = 0;
  return {
    enabled: input.password.length > 0 && input.sessionSecret.length > 0,
    password: input.password,
    sessionSecret: input.sessionSecret,
    loginAttempts: new Map(),
    recordSessionIssued: () => {
      issued += 1;
    },
    activeSessions: () => issued,
  };
}
```

- [ ] **Step 4: Wire into `AppContext`**

Edit `src/server-context.ts`:

```ts
import { createWebUiState, deriveSessionSecret, type WebUiState } from "./admin/state";

export type AppContext = {
  config: AppConfig;
  drime: DrimeClient;
  gatewayWorkspaceId: number | null;
  folderCache: FolderPathCache;
  listCache: ListTtlCache;
  multipartStore: MultipartSessionStore;
  webUi: WebUiState;
  logger: Logger;
};
```

In `createAppContext`, after caches are constructed:

```ts
let webUi: WebUiState;
if (input.config.webUi.password.length === 0) {
  webUi = createWebUiState({ password: "", sessionSecret: new Uint8Array(0) });
} else {
  const secret = await deriveSessionSecret(
    input.config.webUi.password,
    input.config.webUi.sessionSecret,
  );
  webUi = createWebUiState({
    password: input.config.webUi.password,
    sessionSecret: secret,
  });
}
```

Include `webUi` in the returned object.

- [ ] **Step 5: Run tests → PASS** (`bun test tests/admin/state.test.ts`). Typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/admin/state.ts src/server-context.ts tests/admin/state.test.ts
git commit -m "feat(admin): WebUiState — session-secret derivation + active-session counter"
```

---

### Task 3: Cookie sign / verify helpers

Goal: opaque session payload signed with HMAC-SHA256 over the session secret. Format: `base64url(payload).base64url(mac)`. Payload is `{iat, exp, v}`.

**Files:**
- Create: `src/admin/cookies.ts`
- Test: `tests/admin/cookies.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
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

  test("parseCookieHeader extracts named cookie", () => {
    expect(parseCookieHeader("a=1; drime_admin=xyz; b=2", "drime_admin")).toBe("xyz");
    expect(parseCookieHeader(null, "drime_admin")).toBeNull();
    expect(parseCookieHeader("", "drime_admin")).toBeNull();
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
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `src/admin/cookies.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

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
  if (i <= 0 || i === token.length - 1) return { ok: false, reason: "malformed" };
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

export function parseCookieHeader(header: string | null, name: string): string | null {
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
  else if (typeof opts.ttlSec === "number") parts.push(`Max-Age=${opts.ttlSec}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}
```

- [ ] **Step 4: Run test → PASS. Typecheck.**

- [ ] **Step 5: Commit**

```bash
git add src/admin/cookies.ts tests/admin/cookies.test.ts
git commit -m "feat(admin): HMAC-SHA256 session token sign/verify and cookie helpers"
```

---

### Task 4: Password verify (constant-time) + per-IP rate limiter

Goal: a `verifyPassword` helper using `crypto.timingSafeEqual` (with length-mismatch dummy compare), and a token-bucket login rate limiter (5 attempts / 5 min sliding).

**Files:**
- Create: `src/admin/auth.ts`
- Test: `tests/admin/auth-helpers.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { verifyPassword, checkAndRecordLoginAttempt } from "../../src/admin/auth";

describe("admin/auth helpers", () => {
  test("verifyPassword returns true on match, false on mismatch", () => {
    expect(verifyPassword("hunter2-hunter2", "hunter2-hunter2")).toBe(true);
    expect(verifyPassword("hunter2-hunter2", "wrong")).toBe(false);
    expect(verifyPassword("hunter2-hunter2", "hunter2-hunter3")).toBe(false);
  });

  test("verifyPassword returns false (no throw) when length differs", () => {
    expect(verifyPassword("a", "abcdefghij")).toBe(false);
    expect(verifyPassword("abcdefghij", "a")).toBe(false);
  });

  test("verifyPassword returns false when configured password is empty", () => {
    expect(verifyPassword("", "anything")).toBe(false);
  });

  test("checkAndRecordLoginAttempt allows up to 5 then 429s; resets after window", () => {
    const map = new Map<string, { count: number; firstAttemptMs: number }>();
    const ip = "1.2.3.4";
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      const r = checkAndRecordLoginAttempt(map, ip, t0 + i);
      expect(r.allowed).toBe(true);
    }
    const r6 = checkAndRecordLoginAttempt(map, ip, t0 + 5);
    expect(r6.allowed).toBe(false);
    expect(r6.retryAfterSec).toBeGreaterThan(0);

    // After 5 minutes the window resets.
    const r7 = checkAndRecordLoginAttempt(map, ip, t0 + 5 * 60_000 + 1);
    expect(r7.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `src/admin/auth.ts`**

```ts
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export type LoginAttempt = { count: number; firstAttemptMs: number };

export function verifyPassword(configured: string, provided: string): boolean {
  if (configured.length === 0) return false;
  if (configured.length !== provided.length) {
    // Dummy compare on equal-length buffers to keep timing constant.
    const a = Buffer.alloc(Math.max(configured.length, 1), 0x00);
    const b = Buffer.alloc(a.length, 0xff);
    timingSafeEqual(a, b);
    return false;
  }
  const a = Buffer.from(configured, "utf8");
  const b = Buffer.from(provided, "utf8");
  return timingSafeEqual(a, b);
}

export function checkAndRecordLoginAttempt(
  map: Map<string, LoginAttempt>,
  ip: string,
  nowMs: number,
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const rec = map.get(ip);
  if (!rec || nowMs - rec.firstAttemptMs > WINDOW_MS) {
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
```

- [ ] **Step 4: Run test → PASS. Typecheck.**

- [ ] **Step 5: Commit**

```bash
git add src/admin/auth.ts tests/admin/auth-helpers.test.ts
git commit -m "feat(admin): constant-time password compare and per-IP login rate limiter"
```

---

### Task 5: Admin error helper + JSON envelope

Goal: a single `jsonError(code, message, status)` helper for uniform admin error responses, and `jsonOk` for happy paths. All admin responses include `Cache-Control: no-store`.

**Files:**
- Create: `src/admin/errors.ts`
- Test: `tests/admin/errors.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { jsonError, jsonOk, jsonStream } from "../../src/admin/errors";

describe("admin/errors", () => {
  test("jsonError returns the documented envelope", async () => {
    const r = jsonError("Unauthorized", "bad password", 401);
    expect(r.status).toBe(401);
    expect(r.headers.get("Content-Type")).toBe("application/json");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const j = await r.json();
    expect(j).toEqual({ error: { code: "Unauthorized", message: "bad password" } });
  });

  test("jsonError includes details when provided", async () => {
    const r = jsonError("RateLimited", "slow down", 429, { retryAfter: 30 });
    expect((await r.json()).error.details).toEqual({ retryAfter: 30 });
  });

  test("jsonOk returns 200 with payload + no-store", async () => {
    const r = jsonOk({ ok: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });

  test("jsonOk applies custom status code", () => {
    const r = jsonOk({}, 204);
    expect(r.status).toBe(204);
  });

  test("jsonStream attaches no-store and given content-type", async () => {
    const r = jsonStream(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1,2])); c.close(); } }), {
      contentType: "application/octet-stream",
      contentLength: 2,
    });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(r.headers.get("Content-Length")).toBe("2");
    const buf = await r.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2]));
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `src/admin/errors.ts`**

```ts
const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE },
  });
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
  extraHeaders?: HeadersInit,
): Response {
  const body = { error: details ? { code, message, details } : { code, message } };
  const h = new Headers(extraHeaders);
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function jsonStream(
  body: BodyInit,
  init: { status?: number; contentType: string; contentLength?: number; extra?: HeadersInit },
): Response {
  const h = new Headers(init.extra);
  h.set("Content-Type", init.contentType);
  h.set("Cache-Control", "no-store");
  if (typeof init.contentLength === "number") h.set("Content-Length", String(init.contentLength));
  return new Response(body, { status: init.status ?? 200, headers: h });
}
```

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/admin/errors.ts tests/admin/errors.test.ts
git commit -m "feat(admin): jsonOk / jsonError / jsonStream response helpers"
```

---

### Task 6: Shared test helpers (`tests/admin/helpers.ts`)

Goal: one place for `testConfig()`, `startContext()`, and `loginCookie()` — reused by every admin test from Task 7 onward.

**Files:**
- Create: `tests/admin/helpers.ts`

- [ ] **Step 1: Write the helpers**

```ts
import pino from "pino";
import type { AppConfig } from "../../src/config";
import { dispatch } from "../../src/s3/router";
import { type AppContext, createAppContext } from "../../src/server-context";
import { startMockDrime, type MockDrimeServer } from "../fixtures/mock-drime/server";

export type AdminTestSetup = {
  ctx: AppContext;
  mock: MockDrimeServer;
  call: (req: Request) => Promise<Response>;
  cleanup: () => void;
};

export function adminTestConfig(
  apiBaseUrl: string,
  overrides?: Partial<{ password: string; sessionSecretHex: string; insecure: boolean }>,
): AppConfig {
  return {
    s3: { accessKey: "AKIATEST", secretKey: "x".repeat(40), region: "drime" },
    drime: { apiKey: "mock-drime-key", apiBaseUrl, gatewayWorkspaceName: "drime-s3" },
    server: { host: "127.0.0.1", port: 8081 },
    webUi: {
      password: overrides?.password ?? "hunter2-hunter2",
      sessionSecret: overrides?.sessionSecretHex ?? "deadbeef".repeat(8),
    },
    insecure: overrides?.insecure ?? true,
  };
}

export async function startAdmin(
  options?: {
    seedRootFolders?: string[];
    config?: Partial<AppConfig>;
    password?: string;
    sessionSecretHex?: string;
  },
): Promise<AdminTestSetup> {
  const mock = await startMockDrime({ seedRootFolders: options?.seedRootFolders });
  const cfg = adminTestConfig(mock.baseUrl, {
    password: options?.password,
    sessionSecretHex: options?.sessionSecretHex,
  });
  const merged = { ...cfg, ...(options?.config ?? {}) } as AppConfig;
  const ctx = await createAppContext({ config: merged, logger: pino({ level: "silent" }) });
  return {
    ctx,
    mock,
    call: (req) => dispatch(ctx, req),
    cleanup: () => mock.stop(),
  };
}

/** Logs in and returns the `drime_admin=...` cookie value. Assumes admin enabled. */
export async function loginCookie(
  setup: AdminTestSetup,
  password: string,
): Promise<string> {
  const res = await setup.call(
    new Request("http://127.0.0.1:8081/_admin/login", {
      method: "POST",
      headers: { Host: "127.0.0.1:8081", "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not set a cookie");
  const eq = setCookie.indexOf(";");
  return eq === -1 ? setCookie : setCookie.slice(0, eq);
}
```

- [ ] **Step 2: Verify import resolves with typecheck**

Run: `bun run typecheck` → no errors. (No tests yet — these helpers are exercised by every later task.)

- [ ] **Step 3: Commit**

```bash
git add tests/admin/helpers.ts
git commit -m "test(admin): shared test helpers (config, ctx, login)"
```

---

### Task 7: Admin router scaffold (`/_admin/*`)

Goal: a single `dispatchAdmin(ctx, req, url)` entry point. Returns `503 AdminDisabled` when `webUi.enabled === false` (except for `GET /_admin/health`). Returns `404 NotFound` for unknown routes. Handlers added in later tasks plug in here.

**Files:**
- Create: `src/admin/router.ts`
- Test: `tests/admin/scaffold.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import pino from "pino";
import { dispatchAdmin } from "../../src/admin/router";
import type { AppContext } from "../../src/server-context";
import { createAppContext } from "../../src/server-context";
import { adminTestConfig } from "./helpers";
import { startMockDrime } from "../fixtures/mock-drime/server";

async function ctxWith(password: string): Promise<{ ctx: AppContext; stop: () => void }> {
  const mock = await startMockDrime();
  const cfg = adminTestConfig(mock.baseUrl, { password });
  const ctx = await createAppContext({ config: cfg, logger: pino({ level: "silent" }) });
  return { ctx, stop: () => mock.stop() };
}

describe("admin router scaffold", () => {
  test("returns 503 AdminDisabled when WEB_UI_PASSWORD unset (except /health)", async () => {
    const { ctx, stop } = await ctxWith("");
    try {
      const url = new URL("http://127.0.0.1:8081/_admin/session");
      const res = await dispatchAdmin(ctx, new Request(url), url);
      expect(res.status).toBe(503);
      const j = await res.json() as { error: { code: string } };
      expect(j.error.code).toBe("AdminDisabled");
    } finally {
      stop();
    }
  });

  test("returns 404 NotFound for unknown admin path when enabled", async () => {
    const { ctx, stop } = await ctxWith("hunter2-hunter2");
    try {
      const url = new URL("http://127.0.0.1:8081/_admin/no-such-thing");
      const res = await dispatchAdmin(ctx, new Request(url), url);
      expect(res.status).toBe(404);
      const j = await res.json() as { error: { code: string } };
      expect(j.error.code).toBe("NotFound");
    } finally {
      stop();
    }
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `src/admin/router.ts`** (handlers stubbed)

```ts
import type { AppContext } from "../server-context";
import { jsonError } from "./errors";

export async function dispatchAdmin(
  ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  const method = req.method.toUpperCase();
  const path = url.pathname;

  // Public health is always available, even without WEB_UI_PASSWORD.
  if (method === "GET" && path === "/_admin/health") {
    // Real handler wired in Task 9.
    return jsonError("NotFound", "Not Implemented", 404);
  }

  if (!ctx.webUi.enabled) {
    return jsonError(
      "AdminDisabled",
      "Set WEB_UI_PASSWORD in the environment to enable the admin UI.",
      503,
    );
  }

  // Real route table grows in later tasks.
  return jsonError("NotFound", `No admin route for ${method} ${path}`, 404);
}
```

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/admin/router.ts tests/admin/scaffold.test.ts
git commit -m "feat(admin): router scaffold with AdminDisabled gate"
```

---

### Task 8: Front-of-line dispatch in `src/s3/router.ts`

Goal: route `/_admin/*` to `dispatchAdmin` (before Sig V4); route `/_ui/*` to a stub (returns 404 for now, replaced in Plan B); redirect `GET /` to `/_ui/` when the request looks like a browser hit (Accept: text/html with no AWS auth).

**Files:**
- Modify: `src/s3/router.ts`
- Create: `src/admin/ui-assets.ts`
- Test: `tests/admin/dispatch.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
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
          headers: { Host: "127.0.0.1:8081", Accept: "text/html,application/xhtml+xml" },
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

  test("/_ui/* returns 404 in Plan A (stub)", async () => {
    const setup = await startAdmin();
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_ui/index.html", {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(404);
    } finally {
      setup.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `src/admin/ui-assets.ts` stub**

```ts
import type { AppContext } from "../server-context";

/**
 * Stub: returns 404 in Plan A. Plan B replaces this with a real serve-from-embedded
 * + serve-from-disk implementation.
 */
export async function dispatchUiAssets(
  _ctx: AppContext,
  _req: Request,
  _url: URL,
): Promise<Response> {
  return new Response("Not Found", { status: 404 });
}
```

- [ ] **Step 4: Modify `src/s3/router.ts` — add early dispatch**

Add imports near the top:

```ts
import { dispatchAdmin } from "../admin/router";
import { dispatchUiAssets } from "../admin/ui-assets";
```

Add helper functions just above `dispatch`:

```ts
function looksLikeAwsRequest(req: Request, url: URL): boolean {
  if (req.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256")) return true;
  const sp = url.searchParams;
  return sp.has("X-Amz-Signature") || sp.has("X-Amz-Algorithm");
}

function looksLikeBrowserRoot(req: Request, url: URL): boolean {
  if (url.pathname !== "/") return false;
  if (looksLikeAwsRequest(req, url)) return false;
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/html");
}
```

In `dispatch`, after `pathname` is computed and before the existing `OPTIONS` block, insert:

```ts
if (pathname.startsWith("/_admin/")) {
  return dispatchAdmin(ctx, req, url);
}

if (pathname === "/_ui" || pathname.startsWith("/_ui/")) {
  return dispatchUiAssets(ctx, req, url);
}

if (method === "GET" && looksLikeBrowserRoot(req, url)) {
  return new Response(null, {
    status: 302,
    headers: { Location: "/_ui/", "x-amz-request-id": rid },
  });
}
```

(Insert this above the existing `if (method === "OPTIONS" ...)` block.)

- [ ] **Step 5: Update existing `tests/integration/router-health.test.ts`**

The existing test "GET / returns ListAllMyBuckets XML" sends no Accept header. That's still fine — `looksLikeBrowserRoot` requires `text/html` in Accept. Verify by running:

Run: `bun test tests/integration/router-health.test.ts` → PASS unchanged.

If for any reason the test now sees a 302, add an `Accept: */*` or AWS auth header. Otherwise no edits.

- [ ] **Step 6: Run new test → PASS.**

Run: `bun test tests/admin/dispatch.test.ts` → PASS.

- [ ] **Step 7: Run full suite**

Run: `bun test` → all green. Typecheck.

- [ ] **Step 8: Commit**

```bash
git add src/admin/ui-assets.ts src/s3/router.ts tests/admin/dispatch.test.ts
git commit -m "feat(admin): front-of-line dispatch for /_admin and /_ui plus / browser redirect"
```

---

### Task 9: `GET /_admin/health` (public)

Goal: lightweight liveness — no secrets, no auth required.

**Files:**
- Create: `src/admin/handlers/health.ts`
- Modify: `src/admin/router.ts`
- Test: `tests/admin/health.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { startAdmin } from "./helpers";

describe("GET /_admin/health", () => {
  test("returns ok=true and hasPassword=true when password set", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/health", {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { ok: boolean; version: string; hasPassword: boolean };
      expect(j.ok).toBe(true);
      expect(j.hasPassword).toBe(true);
      expect(typeof j.version).toBe("string");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      setup.cleanup();
    }
  });

  test("returns hasPassword=false when WEB_UI_PASSWORD unset", async () => {
    const setup = await startAdmin({ password: "" });
    try {
      const res = await setup.call(
        new Request("http://127.0.0.1:8081/_admin/health", {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { hasPassword: boolean }).hasPassword).toBe(false);
    } finally {
      setup.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `src/admin/handlers/health.ts`**

```ts
import type { AppContext } from "../../server-context";
import { jsonOk } from "../errors";

const VERSION = "0.0.0"; // sourced from package.json at build time in v1.1
export async function handleHealth(ctx: AppContext): Promise<Response> {
  return jsonOk({
    ok: true,
    version: VERSION,
    hasPassword: ctx.webUi.enabled,
  });
}
```

- [ ] **Step 4: Wire into `src/admin/router.ts`**

Replace the existing `if (method === "GET" && path === "/_admin/health")` block:

```ts
if (method === "GET" && path === "/_admin/health") {
  return handleHealth(ctx);
}
```

Add the import: `import { handleHealth } from "./handlers/health";`

- [ ] **Step 5: Run test → PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/admin/handlers/health.ts src/admin/router.ts tests/admin/health.test.ts
git commit -m "feat(admin): GET /_admin/health (public)"
```

---

### Task 10: `POST /_admin/login` + Set-Cookie + rate limit

Goal: validate password, issue signed cookie on success, return 401 on bad password, 429 with `Retry-After` after 5 attempts in 5 min, 503 `AdminDisabled` if password unset (already handled by gate).

**Files:**
- Create: `src/admin/handlers/session.ts`
- Modify: `src/admin/router.ts`
- Test: `tests/admin/auth.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { startAdmin } from "./helpers";

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
          headers: { Host: "127.0.0.1:8081", "Content-Type": "application/json" },
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
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("AdminDisabled");
    } finally {
      setup.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `src/admin/handlers/session.ts`** (login + clientIp helper; logout/session in next task)

```ts
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
```

- [ ] **Step 4: Wire into `src/admin/router.ts`**

Add the import: `import { handleLogin } from "./handlers/session";`

After the health gate and before the disabled check:

Wait — `/login` is also protected behind the disabled gate (returns 503 when disabled). So inside the existing structure, after the `if (!ctx.webUi.enabled)` block, add:

```ts
if (method === "POST" && path === "/_admin/login") {
  return handleLogin(ctx, req, url);
}
```

- [ ] **Step 5: Run test → PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/admin/handlers/session.ts src/admin/router.ts tests/admin/auth.test.ts
git commit -m "feat(admin): POST /_admin/login with rate limit and signed cookie"
```

---

### Task 11: `POST /_admin/logout` and `GET /_admin/session`

Goal: logout clears the cookie; `GET /session` reports cookie validity.

**Files:**
- Modify: `src/admin/handlers/session.ts`
- Modify: `src/admin/router.ts`
- Modify: `tests/admin/auth.test.ts` (extend)

- [ ] **Step 1: Write failing test (append to `tests/admin/auth.test.ts`)**

```ts
import { loginCookie } from "./helpers";

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
      const j = (await res.json()) as { authenticated: boolean; expiresAt: string };
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
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Append to `src/admin/handlers/session.ts`**

```ts
import { parseCookieHeader, verifySessionToken } from "../cookies";

export async function handleLogout(
  _ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  const cookie = buildSetCookie("drime_admin", "", {
    expire: true,
    secure: isHttps(req, url),
  });
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
}

export async function handleGetSession(
  ctx: AppContext,
  req: Request,
): Promise<Response> {
  const raw = parseCookieHeader(req.headers.get("cookie"), "drime_admin");
  if (!raw) return jsonOk({ authenticated: false, expiresAt: null });
  const v = await verifySessionToken(raw, ctx.webUi.sessionSecret, Date.now());
  if (!v.ok) return jsonOk({ authenticated: false, expiresAt: null });
  return jsonOk({
    authenticated: true,
    expiresAt: new Date(v.payload.exp).toISOString(),
  });
}
```

- [ ] **Step 4: Wire into `src/admin/router.ts`**

```ts
import { handleGetSession, handleLogin, handleLogout } from "./handlers/session";

// ... after the login route:
if (method === "POST" && path === "/_admin/logout") {
  return handleLogout(ctx, req, url);
}
if (method === "GET" && path === "/_admin/session") {
  return handleGetSession(ctx, req);
}
```

- [ ] **Step 5: Run test → PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/admin/handlers/session.ts src/admin/router.ts tests/admin/auth.test.ts
git commit -m "feat(admin): POST /_admin/logout and GET /_admin/session"
```

---

### Task 12: Cookie-auth middleware + Origin check for protected routes

Goal: extract the "is this request authenticated?" check into a helper that the protected handlers (Tasks 13+) all use uniformly. Returns `401 Unauthorized` when the cookie is missing or invalid. Also enforces same-origin: when an `Origin` header is present, it must match `Host`.

**Files:**
- Modify: `src/admin/auth.ts`
- Test: `tests/admin/auth.test.ts` (extend)

- [ ] **Step 1: Write failing test (append)**

```ts
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
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("Forbidden");
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
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Add helpers in `src/admin/auth.ts`**

Append to the existing file:

```ts
import type { AppContext } from "../server-context";
import { parseCookieHeader, verifySessionToken } from "./cookies";
import { jsonError } from "./errors";

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
```

- [ ] **Step 4: Wire `checkOrigin` into `src/admin/router.ts`**

Right after the `if (!ctx.webUi.enabled)` block (so health and the disabled gate are unaffected), add:

```ts
const originErr = checkOrigin(req);
if (originErr) return originErr;
```

Add import: `import { checkOrigin } from "./auth";`

`requireSession` is used by handlers in Tasks 13+; nothing else to wire yet for Task 12.

- [ ] **Step 5: Run test → PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/admin/auth.ts src/admin/router.ts tests/admin/auth.test.ts
git commit -m "feat(admin): same-origin enforcement and requireSession helper"
```

---

### Task 13: `GET /_admin/status` (env / drime / workspace)

Goal: produce the JSON the SPA's onboarding wizard consumes. Three blocks: `env` (which envs are present, no values), `drime` (call `/me/workspaces` and report latency), `workspace` (does the configured workspace exist).

**Files:**
- Create: `src/admin/handlers/status.ts`
- Modify: `src/admin/router.ts`
- Modify: `tests/admin/helpers.ts` (add `gatewayWorkspaceName` knob)
- Test: `tests/admin/status.test.ts`

- [ ] **Step 1: Extend `tests/admin/helpers.ts`**

In `startAdmin`, add `gatewayWorkspaceName?: string` to options and pipe it into the merged config (overriding the default `"drime-s3"`):

```ts
export async function startAdmin(
  options?: {
    seedRootFolders?: string[];
    config?: Partial<AppConfig>;
    password?: string;
    sessionSecretHex?: string;
    gatewayWorkspaceName?: string;
  },
): Promise<AdminTestSetup> {
  const mock = await startMockDrime({ seedRootFolders: options?.seedRootFolders });
  const cfg = adminTestConfig(mock.baseUrl, {
    password: options?.password,
    sessionSecretHex: options?.sessionSecretHex,
  });
  if (options?.gatewayWorkspaceName) {
    cfg.drime.gatewayWorkspaceName = options.gatewayWorkspaceName;
  }
  const merged = { ...cfg, ...(options?.config ?? {}) } as AppConfig;
  const ctx = await createAppContext({ config: merged, logger: pino({ level: "silent" }) });
  return { ctx, mock, call: (req) => dispatch(ctx, req), cleanup: () => mock.stop() };
}
```

- [ ] **Step 2: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("GET /_admin/status", () => {
  test("happy path reports env present, drime reachable, workspace exists", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["my-bucket"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/status`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as {
        env: Record<string, unknown>;
        drime: { reachable: boolean; latencyMs: number };
        workspace: { name: string; id: number | null; exists: boolean };
      };
      expect(j.env.drimeApiKeySet).toBe(true);
      expect(j.env.s3KeysSet).toBe(true);
      expect(j.drime.reachable).toBe(true);
      expect(j.drime.latencyMs).toBeGreaterThanOrEqual(0);
      expect(j.workspace.exists).toBe(true);
      expect(j.workspace.name).toBe("drime-s3");
      expect(typeof j.workspace.id).toBe("number");
    } finally {
      setup.cleanup();
    }
  });

  test("workspace.exists=false when configured workspace name doesn't exist", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      gatewayWorkspaceName: "missing-workspace-xyz",
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/status`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { workspace: { exists: boolean; id: number | null } };
      expect(j.workspace.exists).toBe(false);
      expect(j.workspace.id).toBeNull();
    } finally {
      setup.cleanup();
    }
  });

  test("requires session cookie", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const res = await setup.call(
        new Request(`${ORIG}/_admin/status`, {
          headers: { Host: "127.0.0.1:8081" },
        }),
      );
      expect(res.status).toBe(401);
    } finally {
      setup.cleanup();
    }
  });
});
```

- [ ] **Step 3: Run test → FAIL.**

- [ ] **Step 4: Implement `src/admin/handlers/status.ts`**

```ts
import type { AppContext } from "../../server-context";
import { findWorkspaceIdByName } from "../../drime/workspace";
import { jsonOk } from "../errors";

export async function handleStatus(ctx: AppContext): Promise<Response> {
  const env = {
    drimeApiKeySet: ctx.config.drime.apiKey.length > 0,
    drimeApiBaseUrl: ctx.config.drime.apiBaseUrl,
    s3KeysSet:
      ctx.config.s3.accessKey.length > 0 && ctx.config.s3.secretKey.length > 0,
    region: ctx.config.s3.region,
    webUiPasswordSet: ctx.webUi.enabled,
  };

  const t0 = performance.now();
  let reachable = false;
  let latencyMs = 0;
  let error: string | undefined;
  let workspaceId: number | null = null;
  try {
    const rows = await ctx.drime.listWorkspaces();
    latencyMs = Math.round(performance.now() - t0);
    reachable = true;
    const found = findWorkspaceIdByName(rows, ctx.config.drime.gatewayWorkspaceName);
    workspaceId = typeof found === "number" ? found : null;
  } catch (e) {
    latencyMs = Math.round(performance.now() - t0);
    error = e instanceof Error ? e.message : String(e);
  }

  return jsonOk({
    env,
    drime: error ? { reachable, latencyMs, error } : { reachable, latencyMs },
    workspace: {
      name: ctx.config.drime.gatewayWorkspaceName,
      id: workspaceId,
      exists: workspaceId !== null,
    },
  });
}
```

- [ ] **Step 5: Wire into `src/admin/router.ts`**

The router needs a clear public-vs-protected split now. Restructure `dispatchAdmin` to:

```ts
import type { AppContext } from "../server-context";
import { checkOrigin, requireSession } from "./auth";
import { jsonError } from "./errors";
import { handleHealth } from "./handlers/health";
import { handleInit } from "./handlers/init";
import { handleGetSession, handleLogin, handleLogout } from "./handlers/session";
import { handleStatus } from "./handlers/status";

export async function dispatchAdmin(
  ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  const method = req.method.toUpperCase();
  const path = url.pathname;

  if (method === "GET" && path === "/_admin/health") return handleHealth(ctx);

  if (!ctx.webUi.enabled) {
    return jsonError(
      "AdminDisabled",
      "Set WEB_UI_PASSWORD in the environment to enable the admin UI.",
      503,
    );
  }

  const originErr = checkOrigin(req);
  if (originErr) return originErr;

  // Public-when-enabled routes:
  if (method === "POST" && path === "/_admin/login") return handleLogin(ctx, req, url);
  if (method === "POST" && path === "/_admin/logout") return handleLogout(ctx, req, url);
  if (method === "GET" && path === "/_admin/session") return handleGetSession(ctx, req);

  // Protected routes:
  const sessionErr = await requireSession(ctx, req);
  if (sessionErr) return sessionErr;

  if (method === "GET" && path === "/_admin/status") return handleStatus(ctx);
  if (method === "POST" && path === "/_admin/init") return handleInit(ctx);

  return jsonError("NotFound", `No admin route for ${method} ${path}`, 404);
}
```

- [ ] **Step 6: Run test → PASS.** Run full suite (`bun test`) to confirm no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/admin/handlers/status.ts src/admin/router.ts tests/admin/helpers.ts tests/admin/status.test.ts
git commit -m "feat(admin): GET /_admin/status (env, drime reachability, workspace presence)"
```

---

### Task 14: `POST /_admin/init`

Goal: idempotent — calls existing `runInit()` and refreshes `ctx.gatewayWorkspaceId` so the S3 path stops returning 503.

**Files:**
- Create: `src/admin/handlers/init.ts`
- Modify: `src/admin/router.ts` (already wired in Task 13's restructure — just confirm)
- Test: `tests/admin/init.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("POST /_admin/init", () => {
  test("creates the workspace and returns its id", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      gatewayWorkspaceName: "fresh-workspace",
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/init`, {
          method: "POST",
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { workspaceId: number };
      expect(typeof j.workspaceId).toBe("number");
      expect(j.workspaceId).toBeGreaterThan(0);
      expect(setup.ctx.gatewayWorkspaceId).toBe(j.workspaceId);
    } finally {
      setup.cleanup();
    }
  });

  test("idempotent: second call returns the same id", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const headers = { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG };
      const a = await setup.call(
        new Request(`${ORIG}/_admin/init`, { method: "POST", headers }),
      );
      const b = await setup.call(
        new Request(`${ORIG}/_admin/init`, { method: "POST", headers }),
      );
      const ja = (await a.json()) as { workspaceId: number };
      const jb = (await b.json()) as { workspaceId: number };
      expect(ja.workspaceId).toBe(jb.workspaceId);
    } finally {
      setup.cleanup();
    }
  });
});
```

> Mock-fixture note: `startMockDrime` already pre-seeds a workspace named `"drime-s3"` (used by the existing `runInit` integration tests). For the "fresh-workspace" test, the mock's `POST /workspace` route assigns a new id. If for any reason the mock doesn't accept arbitrary names, extend it to do so before this task.

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `src/admin/handlers/init.ts`**

```ts
import { runInit } from "../../cli/init";
import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";

export async function handleInit(ctx: AppContext): Promise<Response> {
  if (!ctx.config.drime.apiKey) {
    return jsonError(
      "DrimeApiKeyMissing",
      "Set DRIME_API_KEY in the environment before initializing.",
      400,
    );
  }
  try {
    const id = await runInit(ctx.config);
    (ctx as { gatewayWorkspaceId: number | null }).gatewayWorkspaceId = id;
    return jsonOk({ workspaceId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError("InitFailed", msg, 502);
  }
}
```

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/admin/handlers/init.ts src/admin/router.ts tests/admin/init.test.ts
git commit -m "feat(admin): POST /_admin/init bootstraps gateway workspace"
```

---

### Task 15: Bucket bridges (`src/admin/shared.ts`) + `/_admin/buckets` CRUD

Goal: JSON bucket list/create/delete using shared bridge functions in `src/admin/shared.ts` (so behavior matches the existing S3 path).

**Files:**
- Create: `src/admin/shared.ts`
- Create: `src/admin/handlers/buckets.ts`
- Modify: `src/admin/router.ts`
- Test: `tests/admin/buckets.test.ts`

- [ ] **Step 1: Write failing test**

```ts
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
        new Request(`${ORIG}/_admin/buckets`, { headers: authedHeaders(cookie) }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { buckets: { name: string; createdAt: string }[]; count: number };
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
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("InvalidBucketName");
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
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `src/admin/shared.ts`** (bucket bridges)

```ts
import { normalizePathKey } from "../cache/folder-paths";
import type { AppContext } from "../server-context";
import { findRootFolder } from "../s3/handlers/bucket";
import { isValidBucketName } from "../s3/naming";

export type BucketSummary = { name: string; createdAt: string };

export async function adminListBuckets(
  ctx: AppContext,
  W: number,
): Promise<BucketSummary[]> {
  const entries = await ctx.listCache.getOrFetch(null, () =>
    ctx.drime.listFolder(null, W),
  );
  return entries
    .filter((e) => e.is_folder && isValidBucketName(e.name))
    .map((e) => ({
      name: e.name,
      createdAt: e.updated_at ?? new Date(0).toISOString(),
    }));
}

export type CreateBucketResult =
  | { kind: "ok" }
  | { kind: "invalid-name" }
  | { kind: "exists" };

export async function adminCreateBucket(
  ctx: AppContext,
  W: number,
  name: string,
): Promise<CreateBucketResult> {
  if (!isValidBucketName(name)) return { kind: "invalid-name" };
  const existing = await findRootFolder(ctx, W, name);
  if (existing !== undefined) return { kind: "exists" };
  const raw = await ctx.drime.createFolder(name, { workspaceId: W });
  const folder =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>).folder : undefined;
  const id =
    folder && typeof folder === "object"
      ? (folder as Record<string, unknown>).id
      : undefined;
  if (typeof id === "number" && Number.isFinite(id)) {
    ctx.folderCache.set(normalizePathKey(name), id);
  }
  ctx.listCache.invalidate(null);
  return { kind: "ok" };
}

export type DeleteBucketResult =
  | { kind: "ok" }
  | { kind: "missing" }
  | { kind: "not-empty" };

export async function adminDeleteBucket(
  ctx: AppContext,
  W: number,
  name: string,
): Promise<DeleteBucketResult> {
  const folder = await findRootFolder(ctx, W, name);
  if (folder === undefined) return { kind: "missing" };
  const children = await ctx.drime.listFolder(folder.id, W);
  if (children.length > 0) return { kind: "not-empty" };
  await ctx.drime.deleteEntriesForever([folder.id]);
  ctx.listCache.invalidate(null);
  ctx.listCache.invalidate(folder.id);
  ctx.folderCache.evictPrefix(normalizePathKey(name));
  return { kind: "ok" };
}
```

- [ ] **Step 4: Implement `src/admin/handlers/buckets.ts`**

```ts
import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import {
  adminCreateBucket,
  adminDeleteBucket,
  adminListBuckets,
} from "../shared";

function workspaceUnavailable(): Response {
  return jsonError(
    "WorkspaceUnavailable",
    "Gateway workspace not initialized — call POST /_admin/init.",
    503,
  );
}

export async function handleListBucketsAdmin(ctx: AppContext): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const buckets = await adminListBuckets(ctx, ctx.gatewayWorkspaceId);
  return jsonOk({ buckets, count: buckets.length });
}

export async function handleCreateBucketAdmin(
  ctx: AppContext,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  let body: { name?: unknown };
  try {
    body = (await req.json()) as { name?: unknown };
  } catch {
    return jsonError("BadRequest", "Body must be JSON.", 400);
  }
  const name = typeof body.name === "string" ? body.name : "";
  const r = await adminCreateBucket(ctx, ctx.gatewayWorkspaceId, name);
  if (r.kind === "invalid-name") {
    return jsonError("InvalidBucketName", "The specified bucket name is not valid.", 400);
  }
  if (r.kind === "exists") {
    return jsonError("BucketAlreadyExists", "The requested bucket name is not available.", 409);
  }
  return jsonOk({ name }, 201);
}

export async function handleDeleteBucketAdmin(
  ctx: AppContext,
  bucket: string,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const r = await adminDeleteBucket(ctx, ctx.gatewayWorkspaceId, bucket);
  if (r.kind === "missing") {
    return jsonError("NoSuchBucket", "The specified bucket does not exist.", 404);
  }
  if (r.kind === "not-empty") {
    return jsonError("BucketNotEmpty", "The bucket you tried to delete is not empty.", 409);
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 5: Wire into `src/admin/router.ts`** (in the protected block, before the 404 fallthrough)

```ts
import {
  handleCreateBucketAdmin,
  handleDeleteBucketAdmin,
  handleListBucketsAdmin,
} from "./handlers/buckets";

// after init route:
if (path === "/_admin/buckets" && method === "GET") return handleListBucketsAdmin(ctx);
if (path === "/_admin/buckets" && method === "POST") return handleCreateBucketAdmin(ctx, req);
const bucketOnly = /^\/_admin\/buckets\/([^/]+)$/.exec(path);
if (bucketOnly && method === "DELETE") {
  return handleDeleteBucketAdmin(ctx, decodeURIComponent(bucketOnly[1] ?? ""));
}
```

- [ ] **Step 6: Run test → PASS.**

- [ ] **Step 7: Commit**

```bash
git add src/admin/shared.ts src/admin/handlers/buckets.ts src/admin/router.ts tests/admin/buckets.test.ts
git commit -m "feat(admin): JSON bucket CRUD via /_admin/buckets"
```

---

### Task 16: Refactor `handleListObjects` to share a pure helper

Goal: extract the listing/pagination logic from `src/s3/handlers/list-objects.ts` into a pure function returning a JSON-shaped result; have the existing XML handler wrap it. The admin handler in Task 17 then reuses the same helper and emits JSON directly.

**Files:**
- Modify: `src/s3/handlers/list-objects.ts`
- Test: `tests/integration/list-objects.test.ts` (must still pass after refactor)

- [ ] **Step 1: Add the JSON shape and the pure helper at the top of the file**

```ts
export type AdminObject = {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
};

export type AdminListing = {
  prefix: string;
  delimiter: string;
  objects: AdminObject[];
  commonPrefixes: string[];
  isTruncated: boolean;
  nextToken: string | null;
  // For XML-side reuse:
  keyCount: number;
  maxKeys: number;
  continuationToken: string | null;
  rawBucket: string;
};

/**
 * Pure listing/pagination logic shared by the XML and JSON listing endpoints.
 * Throws nothing — returns an empty result when the prefix folder is missing.
 */
export async function listObjectsCore(
  ctx: AppContext,
  input: {
    bucket: string;
    url: URL;
    workspaceId: number;
    bucketFolderId: number;
  },
): Promise<AdminListing> {
  // ... (move all the logic from handleListObjects here, but instead of
  // building XML at the end, return AdminListing.)
}
```

The mechanical move:
- Take everything inside `handleListObjects` from `const sp = url.searchParams;` through the `outContents`/`outPrefixes` aggregation.
- Map each `ListBucketEntry` (`Key/Size/LastModified/ETag`) into an `AdminObject` (`key/size/lastModified/etag`, dropping the `StorageClass`).
- Return `AdminListing` with all derived fields populated.

- [ ] **Step 2: Reduce `handleListObjects` to a thin XML wrapper**

```ts
export async function handleListObjects(
  ctx: AppContext,
  input: {
    bucket: string;
    url: URL;
    workspaceId: number;
    bucketFolderId: number;
  },
): Promise<Response> {
  const r = await listObjectsCore(ctx, input);
  const isV2 = input.url.searchParams.get("list-type") === "2";

  // Re-build the XML view from AdminListing.
  const contents: ListBucketEntry[] = r.objects.map((o) => ({
    Key: o.key,
    LastModified: o.lastModified,
    ETag: o.etag,
    Size: o.size,
    StorageClass: "STANDARD",
  }));

  const xml = listBucketResultXml({
    name: r.rawBucket,
    prefix: r.prefix,
    keyCount: r.keyCount,
    maxKeys: r.maxKeys,
    isTruncated: r.isTruncated,
    contents,
    commonPrefixes: r.commonPrefixes.map((Prefix) => ({ Prefix })),
    ...(isV2
      ? {
          continuationToken: r.continuationToken ?? undefined,
          nextContinuationToken: r.nextToken ?? undefined,
        }
      : {}),
  });

  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
}
```

- [ ] **Step 3: Run existing list-objects tests → still PASS**

Run: `bun test tests/integration/list-objects.test.ts` → all green.
Run: `bun run typecheck` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/s3/handlers/list-objects.ts
git commit -m "refactor(s3): extract listObjectsCore returning AdminListing for JSON reuse"
```

---

### Task 17: `GET /_admin/buckets/:bucket/objects` (JSON listing)

Goal: paginated JSON listing for the SPA bucket-detail page. Reuses `listObjectsCore` from Task 16.

**Files:**
- Modify: `src/admin/shared.ts`
- Create: `src/admin/handlers/objects.ts`
- Modify: `src/admin/router.ts`
- Test: `tests/admin/objects-list.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";
function H(cookie: string) {
  return { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG };
}

async function putViaS3(setup: { call: (r: Request) => Promise<Response> }, bucket: string, key: string, body: string) {
  const r = await setup.call(
    new Request(`${ORIG}/${bucket}/${key}`, {
      method: "PUT",
      headers: { Host: "127.0.0.1:8081", "Content-Length": String(body.length) },
      body,
    }),
  );
  if (r.status !== 200) throw new Error(`put failed ${r.status}`);
}

describe("GET /_admin/buckets/:b/objects", () => {
  test("returns JSON listing with delimiter splitting prefixes", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      await putViaS3(setup, "docs", "a.txt", "hello");
      await putViaS3(setup, "docs", "sub/b.txt", "world");
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects?delimiter=/`, {
          headers: H(cookie),
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as {
        prefix: string;
        delimiter: string;
        objects: { key: string; size: number; etag: string }[];
        commonPrefixes: string[];
        nextToken: string | null;
      };
      expect(j.prefix).toBe("");
      expect(j.delimiter).toBe("/");
      expect(j.objects.map((o) => o.key)).toEqual(["a.txt"]);
      expect(j.commonPrefixes).toEqual(["sub/"]);
      expect(j.nextToken).toBeNull();
    } finally {
      setup.cleanup();
    }
  });

  test("404 NoSuchBucket when bucket missing", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/nope/objects`, { headers: H(cookie) }),
      );
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NoSuchBucket");
    } finally {
      setup.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Add `adminListObjects` to `src/admin/shared.ts`**

```ts
import { findRootFolder } from "../s3/handlers/bucket";
import { listObjectsCore, type AdminListing } from "../s3/handlers/list-objects";

export type ListObjectsQuery = {
  prefix?: string;
  delimiter?: string;
  token?: string;
  max?: number;
};

export type ListObjectsResult =
  | { kind: "ok"; listing: AdminListing }
  | { kind: "no-such-bucket" };

export async function adminListObjects(
  ctx: AppContext,
  W: number,
  bucket: string,
  q: ListObjectsQuery,
): Promise<ListObjectsResult> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) return { kind: "no-such-bucket" };

  // Build a synthetic URL that listObjectsCore knows how to parse.
  const u = new URL(`http://internal/${bucket}`);
  if (q.prefix) u.searchParams.set("prefix", q.prefix);
  if (q.delimiter) u.searchParams.set("delimiter", q.delimiter);
  if (q.token) u.searchParams.set("continuation-token", q.token);
  u.searchParams.set("list-type", "2");
  if (q.max) u.searchParams.set("max-keys", String(Math.min(1000, Math.max(1, q.max))));

  const listing = await listObjectsCore(ctx, {
    bucket,
    url: u,
    workspaceId: W,
    bucketFolderId: folder.id,
  });
  return { kind: "ok", listing };
}
```

- [ ] **Step 4: Implement `src/admin/handlers/objects.ts`**

```ts
import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import { adminListObjects } from "../shared";

function workspaceUnavailable(): Response {
  return jsonError(
    "WorkspaceUnavailable",
    "Gateway workspace not initialized — call POST /_admin/init.",
    503,
  );
}

export async function handleListObjectsAdmin(
  ctx: AppContext,
  bucket: string,
  url: URL,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const sp = url.searchParams;
  const r = await adminListObjects(ctx, ctx.gatewayWorkspaceId, bucket, {
    prefix: sp.get("prefix") ?? undefined,
    delimiter: sp.get("delimiter") ?? undefined,
    token: sp.get("token") ?? undefined,
    max: sp.has("max") ? Number(sp.get("max")) : undefined,
  });
  if (r.kind === "no-such-bucket") {
    return jsonError("NoSuchBucket", "The specified bucket does not exist.", 404);
  }
  const l = r.listing;
  return jsonOk({
    prefix: l.prefix,
    delimiter: l.delimiter,
    objects: l.objects,
    commonPrefixes: l.commonPrefixes,
    nextToken: l.nextToken,
  });
}
```

- [ ] **Step 5: Wire into `src/admin/router.ts`**

```ts
import { handleListObjectsAdmin } from "./handlers/objects";

const objectsList = /^\/_admin\/buckets\/([^/]+)\/objects$/.exec(path);
if (objectsList && method === "GET") {
  return handleListObjectsAdmin(ctx, decodeURIComponent(objectsList[1] ?? ""), url);
}
```

- [ ] **Step 6: Run test → PASS.**

- [ ] **Step 7: Commit**

```bash
git add src/admin/shared.ts src/admin/handlers/objects.ts src/admin/router.ts tests/admin/objects-list.test.ts
git commit -m "feat(admin): GET /_admin/buckets/:b/objects (JSON listing)"
```

---

### Task 18: `PUT /_admin/buckets/:bucket/objects/*key` (streaming upload)

Goal: stream the request body straight into the existing PUT object pipeline by constructing a synthetic Sig-V4-shaped request and dispatching it to `handleObjectRequest`. Translate XML success/error to JSON.

**Files:**
- Modify: `src/admin/shared.ts` (add `adminPutObject`)
- Modify: `src/admin/handlers/objects.ts`
- Modify: `src/admin/router.ts`
- Test: `tests/admin/objects-put.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("PUT /_admin/buckets/:b/objects/*key", () => {
  test("streams body into bucket; returns { etag, size }", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const body = "hello, drime";
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/folder/hello.txt`, {
          method: "PUT",
          headers: {
            Host: "127.0.0.1:8081",
            Cookie: cookie,
            Origin: ORIG,
            "Content-Type": "text/plain",
            "Content-Length": String(body.length),
          },
          body,
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { etag: string; size: number };
      expect(j.etag).toMatch(/^"[0-9a-f]{32}"$/);
      expect(j.size).toBe(body.length);

      // Confirm the file is now visible via the JSON listing.
      const listed = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects?prefix=folder/`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      const lj = (await listed.json()) as { objects: { key: string }[] };
      expect(lj.objects.some((o) => o.key === "folder/hello.txt")).toBe(true);
    } finally {
      setup.cleanup();
    }
  });

  test("404 NoSuchBucket when bucket missing", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/nope/objects/file.txt`, {
          method: "PUT",
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
          body: "x",
        }),
      );
      expect(res.status).toBe(404);
    } finally {
      setup.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Add `adminPutObject` to `src/admin/shared.ts`**

```ts
import { handleObjectRequest } from "../s3/handlers/object";

export type PutObjectResult =
  | { kind: "ok"; etag: string; size: number }
  | { kind: "no-such-bucket" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; status: number; code: string; message: string };

export async function adminPutObject(
  ctx: AppContext,
  W: number,
  bucket: string,
  key: string,
  body: ReadableStream<Uint8Array> | ArrayBuffer | null,
  contentType: string | null,
  contentLength: number | null,
): Promise<PutObjectResult> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) return { kind: "no-such-bucket" };

  const u = new URL(`http://internal/${bucket}/${encodeKeyForUrl(key)}`);
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  if (contentLength !== null) headers.set("content-length", String(contentLength));
  // Plain stream, NOT aws-chunked — admin uploads do not use Sig V4 chunked encoding.
  headers.set("x-amz-content-sha256", "UNSIGNED-PAYLOAD");

  const synthReq = new Request(u, { method: "PUT", headers, body });
  const res = await handleObjectRequest(ctx, {
    method: "PUT",
    bucket,
    key,
    url: u,
    req: synthReq,
    workspaceId: W,
  });
  if (res === null) {
    return { kind: "error", status: 500, code: "InternalError", message: "Object handler returned null." };
  }
  if (res.status === 200) {
    const etag = res.headers.get("etag") ?? '"unknown"';
    return { kind: "ok", etag, size: contentLength ?? 0 };
  }
  // Translate XML error → JSON kind.
  return await translateS3XmlError(res);
}

function encodeKeyForUrl(key: string): string {
  return key.split("/").map((p) => encodeURIComponent(p)).join("/");
}

async function translateS3XmlError(res: Response): Promise<PutObjectResult> {
  const text = await res.text();
  const codeMatch = /<Code>([^<]+)<\/Code>/.exec(text);
  const msgMatch = /<Message>([^<]*)<\/Message>/.exec(text);
  const code = codeMatch?.[1] ?? "InternalError";
  const message = msgMatch?.[1] ?? "Object operation failed.";
  if (code === "NoSuchBucket") return { kind: "no-such-bucket" };
  if (res.status >= 400 && res.status < 500) return { kind: "invalid", message };
  return { kind: "error", status: res.status, code, message };
}
```

- [ ] **Step 4: Add the handler in `src/admin/handlers/objects.ts`**

```ts
import { adminPutObject } from "../shared";

export async function handlePutObjectAdmin(
  ctx: AppContext,
  bucket: string,
  key: string,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const cl = req.headers.get("content-length");
  const len = cl === null ? null : Number.parseInt(cl, 10);
  const ct = req.headers.get("content-type");
  const r = await adminPutObject(
    ctx,
    ctx.gatewayWorkspaceId,
    bucket,
    key,
    req.body,
    ct,
    Number.isFinite(len) ? (len as number) : null,
  );
  if (r.kind === "no-such-bucket") {
    return jsonError("NoSuchBucket", "The specified bucket does not exist.", 404);
  }
  if (r.kind === "invalid") {
    return jsonError("BadRequest", r.message, 400);
  }
  if (r.kind === "error") {
    return jsonError(r.code, r.message, r.status);
  }
  return jsonOk({ etag: r.etag, size: r.size });
}
```

- [ ] **Step 5: Wire into `src/admin/router.ts`**

```ts
import { handlePutObjectAdmin } from "./handlers/objects";

const objectMatch = /^\/_admin\/buckets\/([^/]+)\/objects\/(.+)$/.exec(path);
if (objectMatch && method === "PUT") {
  const bucket = decodeURIComponent(objectMatch[1] ?? "");
  const keyEnc = objectMatch[2] ?? "";
  const key = keyEnc.split("/").map((p) => decodeURIComponent(p)).join("/");
  return handlePutObjectAdmin(ctx, bucket, key, req);
}
```

- [ ] **Step 6: Run test → PASS.** Run `bun test` to ensure no S3 regressions.

- [ ] **Step 7: Commit**

```bash
git add src/admin/shared.ts src/admin/handlers/objects.ts src/admin/router.ts tests/admin/objects-put.test.ts
git commit -m "feat(admin): PUT /_admin/buckets/:b/objects/*key (streaming upload)"
```

---

### Task 19: `GET /_admin/buckets/:bucket/objects/*key` (download with Range)

Goal: stream object bytes back to the browser. Reuses the existing GET-object pipeline. Honors the `Range` header transparently because the upstream Drime download URL forwards it.

**Files:**
- Modify: `src/admin/shared.ts` (add `adminGetObject`)
- Modify: `src/admin/handlers/objects.ts`
- Modify: `src/admin/router.ts`
- Test: `tests/admin/objects-get.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("GET /_admin/buckets/:b/objects/*key", () => {
  test("downloads previously uploaded object (full body)", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const body = "drime-payload-1234567890";
      const put = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/file.bin`, {
          method: "PUT",
          headers: {
            Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG,
            "Content-Length": String(body.length),
          },
          body,
        }),
      );
      expect(put.status).toBe(200);

      const get = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/file.bin`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(get.status).toBe(200);
      expect(await get.text()).toBe(body);
    } finally {
      setup.cleanup();
    }
  });

  test("404 when key missing", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/missing.txt`, {
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(res.status).toBe(404);
    } finally {
      setup.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Add `adminGetObject` to `src/admin/shared.ts`**

```ts
export async function adminGetObject(
  ctx: AppContext,
  W: number,
  bucket: string,
  key: string,
  range: string | null,
): Promise<Response> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) {
    return jsonError("NoSuchBucket", "The specified bucket does not exist.", 404);
  }

  const u = new URL(`http://internal/${bucket}/${encodeKeyForUrl(key)}`);
  const headers = new Headers();
  if (range) headers.set("range", range);

  const synthReq = new Request(u, { method: "GET", headers });
  const res = await handleObjectRequest(ctx, {
    method: "GET", bucket, key, url: u, req: synthReq, workspaceId: W,
  });
  if (res === null) {
    return jsonError("InternalError", "Object handler returned null.", 500);
  }
  if (res.status === 200 || res.status === 206) {
    // Pass through body + content-* headers; strip x-amz-* if any.
    const out = new Headers();
    for (const k of ["content-type", "content-length", "content-range", "etag", "last-modified", "accept-ranges"]) {
      const v = res.headers.get(k);
      if (v) out.set(k, v);
    }
    out.set("Cache-Control", "no-store");
    return new Response(res.body, { status: res.status, headers: out });
  }
  // Translate XML error → JSON envelope.
  const text = await res.text();
  const codeMatch = /<Code>([^<]+)<\/Code>/.exec(text);
  const msgMatch = /<Message>([^<]*)<\/Message>/.exec(text);
  return jsonError(codeMatch?.[1] ?? "InternalError", msgMatch?.[1] ?? "Download failed.", res.status);
}
```

Imports needed: `import { jsonError } from "./errors";`

- [ ] **Step 4: Add the handler in `src/admin/handlers/objects.ts`**

```ts
import { adminGetObject } from "../shared";

export async function handleGetObjectAdmin(
  ctx: AppContext,
  bucket: string,
  key: string,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  return adminGetObject(
    ctx, ctx.gatewayWorkspaceId, bucket, key,
    req.headers.get("range"),
  );
}
```

- [ ] **Step 5: Wire into `src/admin/router.ts`**

```ts
if (objectMatch && method === "GET") {
  const bucket = decodeURIComponent(objectMatch[1] ?? "");
  const keyEnc = objectMatch[2] ?? "";
  const key = keyEnc.split("/").map((p) => decodeURIComponent(p)).join("/");
  return handleGetObjectAdmin(ctx, bucket, key, req);
}
```

- [ ] **Step 6: Run test → PASS.**

- [ ] **Step 7: Commit**

```bash
git add src/admin/shared.ts src/admin/handlers/objects.ts src/admin/router.ts tests/admin/objects-get.test.ts
git commit -m "feat(admin): GET /_admin/buckets/:b/objects/*key (download + Range)"
```

---

### Task 20: `DELETE /_admin/buckets/:bucket/objects/*key` (single)

Goal: single-object delete. Returns 204 even when the key is already absent (matches S3).

**Files:**
- Modify: `src/admin/shared.ts` (add `adminDeleteObject`)
- Modify: `src/admin/handlers/objects.ts`
- Modify: `src/admin/router.ts`
- Test: `tests/admin/objects-delete.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("DELETE /_admin/buckets/:b/objects/*key", () => {
  test("deletes existing object → 204", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const headers = { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG };
      await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/x.txt`, {
          method: "PUT",
          headers: { ...headers, "Content-Length": "1" },
          body: "x",
        }),
      );
      const del = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/x.txt`, {
          method: "DELETE", headers,
        }),
      );
      expect(del.status).toBe(204);

      const get = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/x.txt`, { headers }),
      );
      expect(get.status).toBe(404);
    } finally {
      setup.cleanup();
    }
  });

  test("delete missing key → 204 (idempotent)", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects/never-existed.txt`, {
          method: "DELETE",
          headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG },
        }),
      );
      expect(res.status).toBe(204);
    } finally {
      setup.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Add `adminDeleteObject` in `src/admin/shared.ts`**

```ts
export async function adminDeleteObject(
  ctx: AppContext,
  W: number,
  bucket: string,
  key: string,
): Promise<{ kind: "ok" } | { kind: "no-such-bucket" } | { kind: "error"; status: number; code: string; message: string }> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) return { kind: "no-such-bucket" };

  const u = new URL(`http://internal/${bucket}/${encodeKeyForUrl(key)}`);
  const synthReq = new Request(u, { method: "DELETE", headers: new Headers() });
  const res = await handleObjectRequest(ctx, {
    method: "DELETE", bucket, key, url: u, req: synthReq, workspaceId: W,
  });
  if (res === null) {
    return { kind: "error", status: 500, code: "InternalError", message: "Object handler returned null." };
  }
  if (res.status === 204) return { kind: "ok" };
  const text = await res.text();
  const codeMatch = /<Code>([^<]+)<\/Code>/.exec(text);
  const msgMatch = /<Message>([^<]*)<\/Message>/.exec(text);
  return {
    kind: "error",
    status: res.status,
    code: codeMatch?.[1] ?? "InternalError",
    message: msgMatch?.[1] ?? "Delete failed.",
  };
}
```

- [ ] **Step 4: Add the handler in `src/admin/handlers/objects.ts`**

```ts
import { adminDeleteObject } from "../shared";

export async function handleDeleteObjectAdmin(
  ctx: AppContext,
  bucket: string,
  key: string,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const r = await adminDeleteObject(ctx, ctx.gatewayWorkspaceId, bucket, key);
  if (r.kind === "no-such-bucket") {
    return jsonError("NoSuchBucket", "The specified bucket does not exist.", 404);
  }
  if (r.kind === "error") {
    return jsonError(r.code, r.message, r.status);
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 5: Wire into `src/admin/router.ts`**

```ts
if (objectMatch && method === "DELETE") {
  const bucket = decodeURIComponent(objectMatch[1] ?? "");
  const keyEnc = objectMatch[2] ?? "";
  const key = keyEnc.split("/").map((p) => decodeURIComponent(p)).join("/");
  return handleDeleteObjectAdmin(ctx, bucket, key);
}
```

- [ ] **Step 6: Run test → PASS.**

- [ ] **Step 7: Commit**

```bash
git add src/admin/shared.ts src/admin/handlers/objects.ts src/admin/router.ts tests/admin/objects-delete.test.ts
git commit -m "feat(admin): DELETE /_admin/buckets/:b/objects/*key"
```

---

### Task 21: `POST /_admin/buckets/:bucket/objects:batchDelete`

Goal: bulk delete using the existing batch handler. Body `{ keys: string[] }` (max 1000 per request); response `{ deleted: string[], errors: [{ key, code, message }] }`.

**Files:**
- Modify: `src/admin/handlers/objects.ts`
- Modify: `src/admin/router.ts`
- Test: `tests/admin/objects-batch-delete.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";

describe("POST /_admin/buckets/:b/objects:batchDelete", () => {
  test("deletes multiple objects, reports errors per key", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const headers = { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG };
      for (const k of ["a.txt", "b.txt", "c.txt"]) {
        await setup.call(
          new Request(`${ORIG}/_admin/buckets/docs/objects/${k}`, {
            method: "PUT",
            headers: { ...headers, "Content-Length": "1" },
            body: "x",
          }),
        );
      }
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects:batchDelete`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ keys: ["a.txt", "missing.txt", "b.txt"] }),
        }),
      );
      expect(res.status).toBe(200);
      const j = (await res.json()) as { deleted: string[]; errors: { key: string }[] };
      expect(j.deleted.sort()).toEqual(["a.txt", "b.txt", "missing.txt"]); // S3 returns deleted even when key absent
      expect(j.errors).toEqual([]);
    } finally {
      setup.cleanup();
    }
  });

  test("400 when keys is missing or > 1000", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2", seedRootFolders: ["docs"] });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const headers = {
        Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG, "Content-Type": "application/json",
      };
      const noKeys = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects:batchDelete`, {
          method: "POST", headers, body: JSON.stringify({}),
        }),
      );
      expect(noKeys.status).toBe(400);

      const tooMany = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/objects:batchDelete`, {
          method: "POST", headers,
          body: JSON.stringify({ keys: Array.from({ length: 1001 }, (_, i) => `k${i}`) }),
        }),
      );
      expect(tooMany.status).toBe(400);
    } finally {
      setup.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement `handleBatchDeleteAdmin` in `src/admin/handlers/objects.ts`**

```ts
import { handleDeleteObjects } from "../../s3/handlers/batch";

export async function handleBatchDeleteAdmin(
  ctx: AppContext,
  bucket: string,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  let body: { keys?: unknown };
  try {
    body = (await req.json()) as { keys?: unknown };
  } catch {
    return jsonError("BadRequest", "Body must be JSON.", 400);
  }
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    return jsonError("BadRequest", "Field `keys` must be a non-empty array.", 400);
  }
  if (body.keys.length > 1000) {
    return jsonError("BadRequest", "At most 1000 keys per batch.", 400);
  }
  const keys = body.keys.map(String);

  // Build the S3 batch DELETE XML body and call the existing handler.
  const xmlEntries = keys.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join("");
  const bodyText = `<?xml version="1.0" encoding="UTF-8"?><Delete>${xmlEntries}</Delete>`;
  const res = await handleDeleteObjects(ctx, {
    bucket,
    bodyText,
    workspaceId: ctx.gatewayWorkspaceId,
  });

  // The XML response has <Deleted><Key>k</Key></Deleted> and <Error><Key>k</Key>...</Error> entries.
  const xml = await res.text();
  const deleted: string[] = [];
  const errors: { key: string; code: string; message: string }[] = [];
  for (const m of xml.matchAll(/<Deleted>(?:[\s\S]*?<Key>([^<]+)<\/Key>)/g)) {
    if (m[1]) deleted.push(m[1]);
  }
  for (const m of xml.matchAll(
    /<Error>(?:[\s\S]*?<Key>([^<]+)<\/Key>)(?:[\s\S]*?<Code>([^<]+)<\/Code>)?(?:[\s\S]*?<Message>([^<]*)<\/Message>)?/g,
  )) {
    errors.push({ key: m[1] ?? "", code: m[2] ?? "InternalError", message: m[3] ?? "" });
  }
  return jsonOk({ deleted, errors });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 4: Wire into `src/admin/router.ts`**

```ts
import { handleBatchDeleteAdmin } from "./handlers/objects";

const batchDelete = /^\/_admin\/buckets\/([^/]+)\/objects:batchDelete$/.exec(path);
if (batchDelete && method === "POST") {
  return handleBatchDeleteAdmin(ctx, decodeURIComponent(batchDelete[1] ?? ""), req);
}
```

- [ ] **Step 5: Run test → PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/admin/handlers/objects.ts src/admin/router.ts tests/admin/objects-batch-delete.test.ts
git commit -m "feat(admin): POST /_admin/buckets/:b/objects:batchDelete"
```

---

### Task 22: Startup warning + `/_health` `webUi` block

Goal: when `WEB_UI_PASSWORD` is unset, log a one-line warning at startup. Extend the existing `/_health` JSON to include `webUi: { passwordSet, activeSessions }`.

**Files:**
- Modify: `src/cli/main.ts`
- Modify: `src/s3/router.ts` (the `_health` handler block)
- Modify: `tests/integration/router-health.test.ts` (add new field)

- [ ] **Step 1: Update `_health` test**

In `tests/integration/router-health.test.ts`, change the `_health` test body to also assert:

```ts
const j = (await res.json()) as Record<string, unknown>;
expect(typeof j.folderPathCache).toBe("number");
expect(typeof j.listTtlCache).toBe("number");
expect(typeof j.multipartSessions).toBe("number");
expect(j.webUi).toBeDefined();
const w = j.webUi as { passwordSet: boolean; activeSessions: number };
expect(typeof w.passwordSet).toBe("boolean");
expect(typeof w.activeSessions).toBe("number");
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Update the `_health` handler in `src/s3/router.ts`**

In the existing `/_health` block, change the body to:

```ts
const body = JSON.stringify({
  folderPathCache: ctx.folderCache.size,
  listTtlCache: ctx.listCache.size,
  listTtlInflight: ctx.listCache.inflightSize,
  multipartSessions: ctx.multipartStore.size,
  webUi: {
    passwordSet: ctx.webUi.enabled,
    activeSessions: ctx.webUi.activeSessions(),
  },
});
```

- [ ] **Step 4: Add startup warning in `src/cli/main.ts`**

In the `serve` block, just after `assertSafeInsecureBind`, before creating the context:

```ts
if (!cfg.webUi.password) {
  console.warn(
    "*** WEB_UI_PASSWORD is not set. The admin UI is disabled (only the S3 API is reachable). Set WEB_UI_PASSWORD to enable. ***",
  );
}
```

- [ ] **Step 5: Run test → PASS. Run `bun test` full suite.**

- [ ] **Step 6: Commit**

```bash
git add src/cli/main.ts src/s3/router.ts tests/integration/router-health.test.ts
git commit -m "chore(admin): warn at startup when WEB_UI_PASSWORD unset; expose webUi in _health"
```

---

### Task 23: Manual smoke + final full run

Goal: end-to-end verification of the JSON API against a running gateway with mock Drime. Confirms the plan landed cleanly.

**Files:**
- (No code changes.)

- [ ] **Step 1: Start mock Drime + gateway**

In one terminal:

```bash
WEB_UI_PASSWORD=hunter2-hunter2 \
DRIME_API_KEY=mock-drime-key \
DRIME_S3_INSECURE=1 \
bun run dev
```

Mock Drime is *not* what this command starts — for manual smoke, point `DRIME_API_BASE_URL` at the existing mock fixture, OR exercise against real Drime if you have credentials. Easiest: temporarily run a one-shot mock via a small script that imports `startMockDrime`.

```bash
# scripts/mock-drime.ts (one-off; not committed):
# import { startMockDrime } from "./tests/fixtures/mock-drime/server";
# startMockDrime({ seedRootFolders: ["existing-bucket"] }).then(m => console.log(m.baseUrl));
```

- [ ] **Step 2: Curl the public health**

```bash
curl -i http://127.0.0.1:8081/_admin/health
```

Expected: 200; body contains `"hasPassword":true`.

- [ ] **Step 3: Login → obtain cookie**

```bash
curl -i -X POST http://127.0.0.1:8081/_admin/login \
  -H 'Origin: http://127.0.0.1:8081' \
  -H 'Content-Type: application/json' \
  -c cookies.txt \
  --data '{"password":"hunter2-hunter2"}'
```

Expected: 200, `Set-Cookie: drime_admin=...; HttpOnly; SameSite=Strict; Path=/_admin/`.

- [ ] **Step 4: Status / init / list / put / get / delete via cookie**

```bash
curl -s -b cookies.txt -H 'Origin: http://127.0.0.1:8081' http://127.0.0.1:8081/_admin/status | jq
curl -s -b cookies.txt -H 'Origin: http://127.0.0.1:8081' -X POST http://127.0.0.1:8081/_admin/init | jq
curl -s -b cookies.txt -H 'Origin: http://127.0.0.1:8081' http://127.0.0.1:8081/_admin/buckets | jq
curl -s -b cookies.txt -H 'Origin: http://127.0.0.1:8081' -H 'Content-Type: application/json' \
     -X POST http://127.0.0.1:8081/_admin/buckets --data '{"name":"smoke"}' | jq
echo "hello" | curl -s -b cookies.txt -H 'Origin: http://127.0.0.1:8081' \
     -X PUT --data-binary @- http://127.0.0.1:8081/_admin/buckets/smoke/objects/hello.txt
curl -s -b cookies.txt -H 'Origin: http://127.0.0.1:8081' http://127.0.0.1:8081/_admin/buckets/smoke/objects | jq
curl -s -b cookies.txt -H 'Origin: http://127.0.0.1:8081' http://127.0.0.1:8081/_admin/buckets/smoke/objects/hello.txt
curl -s -o /dev/null -w '%{http_code}' -b cookies.txt -H 'Origin: http://127.0.0.1:8081' \
     -X DELETE http://127.0.0.1:8081/_admin/buckets/smoke/objects/hello.txt
```

Expected: every command behaves as the spec describes.

- [ ] **Step 5: Confirm S3 wire compatibility unchanged**

```bash
bun run smoke:large:aws:selftest
```

Expected: PASS (unchanged).

- [ ] **Step 6: Run full test suite + typecheck + lint**

```bash
bun test && bun run typecheck && bun run lint
```

Expected: all green.

- [ ] **Step 7: Final commit (if any cleanup needed)**

If steps 4-6 surfaced fixups, commit them with `chore(admin): smoke fixes`. Otherwise no commit.

---

## Plan A Done

At this point the gateway exposes a working `/_admin/*` JSON API protected by `WEB_UI_PASSWORD`, the dispatch correctly separates browser/UI/S3 traffic, and `bun test` is green. Plan B builds the React SPA on top of this API.

<!-- TASKS-END -->
