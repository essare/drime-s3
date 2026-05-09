import { describe, expect, it } from "vitest";
import { formatRelativeDate } from "./format";

describe("formatRelativeDate", () => {
  it('returns "just now" for very recent timestamps', () => {
    const now = new Date("2026-05-09T12:00:00.000Z");
    expect(
      formatRelativeDate("2026-05-09T11:59:55.000Z", now),
    ).toBe("just now");
  });

  it("returns hours for same-day offsets", () => {
    const now = new Date("2026-05-09T12:00:00.000Z");
    expect(
      formatRelativeDate("2026-05-09T06:00:00.000Z", now),
    ).toBe("6h ago");
  });

  it("returns days for multi-day offsets", () => {
    const now = new Date("2026-05-09T12:00:00.000Z");
    expect(
      formatRelativeDate("2026-05-06T12:00:00.000Z", now),
    ).toBe("3d ago");
  });

  it("returns the raw string when ISO is invalid", () => {
    expect(formatRelativeDate("not-a-date", new Date())).toBe("not-a-date");
  });
});
