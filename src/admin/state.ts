import { hkdfSync } from "node:crypto";

export type WebUiState = {
  /** True when password is set, secret is non-empty, and the admin UI is enabled. */
  enabled: boolean;
  password: string;
  sessionSecret: Uint8Array;
  /** Per-IP login attempt records (token bucket). Pruned lazily by auth.ts. */
  loginAttempts: Map<string, { count: number; firstAttemptMs: number }>;
  /** Increments the session counter when a login cookie is minted. */
  recordSessionIssued: () => void;
  /** Total login cookies minted since process start (monotonic; not concurrent sessions). */
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
    if (
      sessionSecretHex.length % 2 !== 0 ||
      !/^[0-9a-fA-F]+$/.test(sessionSecretHex)
    ) {
      throw new Error(
        "Invalid session secret: expected even-length hex string",
      );
    }
    const decoded = new Uint8Array(Buffer.from(sessionSecretHex, "hex"));
    if (decoded.length < 16) {
      throw new Error(
        "Invalid session secret: decoded length must be >= 16 bytes",
      );
    }
    return decoded;
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
