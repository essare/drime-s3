import { describe, expect, test } from "bun:test";
import {
  checkAndRecordLoginAttempt,
  verifyPassword,
} from "../../src/admin/auth";

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

  test("verifyPassword returns false (no throw) when UTF-8 byte lengths differ for equal JS lengths", () => {
    // "ä" is 1 JS char but 2 UTF-8 bytes; "a" is 1 char and 1 byte.
    expect(verifyPassword("ä", "a")).toBe(false);
    expect(verifyPassword("a", "ä")).toBe(false);
    // Same JS length, same byte length, different content → still false (sanity).
    expect(verifyPassword("aa", "ab")).toBe(false);
  });

  test("checkAndRecordLoginAttempt isolates per-IP counters", () => {
    const map = new Map<string, { count: number; firstAttemptMs: number }>();
    const t0 = 2_000_000;
    for (let i = 0; i < 5; i++) {
      expect(checkAndRecordLoginAttempt(map, "10.0.0.1", t0 + i).allowed).toBe(
        true,
      );
    }
    // ip-1 is now blocked; ip-2 should still be fresh
    expect(checkAndRecordLoginAttempt(map, "10.0.0.1", t0 + 5).allowed).toBe(
      false,
    );
    expect(checkAndRecordLoginAttempt(map, "10.0.0.2", t0 + 5).allowed).toBe(
      true,
    );
  });

  test("checkAndRecordLoginAttempt prunes stale entries when a fresh attempt arrives", () => {
    const map = new Map<string, { count: number; firstAttemptMs: number }>();
    const t0 = 3_000_000;
    // Two old IPs (window long expired)
    checkAndRecordLoginAttempt(map, "old-1", t0);
    checkAndRecordLoginAttempt(map, "old-2", t0);
    expect(map.size).toBe(2);
    // Fresh IP arriving way after the window expires triggers prune of the old ones
    const after = t0 + 10 * 60_000;
    checkAndRecordLoginAttempt(map, "new-1", after);
    expect(map.has("old-1")).toBe(false);
    expect(map.has("old-2")).toBe(false);
    expect(map.has("new-1")).toBe(true);
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
    if (r6.allowed === false) {
      expect(r6.retryAfterSec).toBeGreaterThan(0);
    }

    // After 5 minutes the window resets.
    const r7 = checkAndRecordLoginAttempt(map, ip, t0 + 5 * 60_000 + 1);
    expect(r7.allowed).toBe(true);
  });
});
