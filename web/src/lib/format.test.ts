import { describe, expect, it } from "vitest";
import { formatBytes, formatRelativeDate } from "./format";

describe("formatBytes", () => {
  it("returns em dash for invalid values", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });

  it("formats small byte values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(500)).toBe("500 B");
  });

  it("steps into larger units with one decimal when under 10", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("rounds when the value is at least 10 in a unit", () => {
    expect(formatBytes(10 * 1024)).toBe("10 KB");
  });
});

describe("formatRelativeDate", () => {
  it('returns "just now" for very recent timestamps', () => {
    const now = new Date("2026-05-09T12:00:00.000Z");
    expect(formatRelativeDate("2026-05-09T11:59:55.000Z", now)).toBe(
      "just now",
    );
  });

  it("returns hours for same-day offsets", () => {
    const now = new Date("2026-05-09T12:00:00.000Z");
    expect(formatRelativeDate("2026-05-09T06:00:00.000Z", now)).toBe("6h ago");
  });

  it("returns days for multi-day offsets", () => {
    const now = new Date("2026-05-09T12:00:00.000Z");
    expect(formatRelativeDate("2026-05-06T12:00:00.000Z", now)).toBe("3d ago");
  });

  it("returns em dash for invalid or epoch timestamps", () => {
    expect(
      formatRelativeDate("1970-01-01T00:00:00.000Z", new Date("2026-05-22")),
    ).toBe("—");
    expect(formatRelativeDate("not-a-date", new Date())).toBe("—");
  });
});
