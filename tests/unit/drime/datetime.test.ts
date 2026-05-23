import { describe, expect, test } from "bun:test";
import {
  drimeTimestampToIso,
  normalizeDrimeIso,
} from "../../../src/drime/datetime";

describe("normalizeDrimeIso", () => {
  test("trims six-digit fractional seconds to milliseconds", () => {
    expect(normalizeDrimeIso("2026-05-21T20:27:32.000000Z")).toBe(
      "2026-05-21T20:27:32.000Z",
    );
  });
});

describe("drimeTimestampToIso", () => {
  test("parses Drime updated_at", () => {
    expect(drimeTimestampToIso("2026-05-21T20:27:32.000000Z", null)).toBe(
      "2026-05-21T20:27:32.000Z",
    );
  });

  test("falls back to created_at when updated_at missing", () => {
    expect(drimeTimestampToIso(null, "2026-05-20T20:17:15.000000Z")).toBe(
      "2026-05-20T20:17:15.000Z",
    );
  });

  test("returns null when both missing", () => {
    expect(drimeTimestampToIso(null, null)).toBeNull();
  });
});
