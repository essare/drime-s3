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

  test("deriveSessionSecret produces different output for different passwords", async () => {
    const a = await deriveSessionSecret("alpha-password-1", "");
    const b = await deriveSessionSecret("beta-password-2", "");
    expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
  });

  test("createWebUiState is disabled when password set but sessionSecret is empty", () => {
    const s = createWebUiState({ password: "set", sessionSecret: new Uint8Array(0) });
    expect(s.enabled).toBe(false);
    expect(s.loginAttempts.size).toBe(0);
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
