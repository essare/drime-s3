import { describe, expect, it } from "vitest";
import { bucketNameSchema, isValidBucketName } from "./bucket-name";

describe("isValidBucketName", () => {
  it.each(["alpha", "alpha-beta-1", "a1b"])("accepts %s", (name) => {
    expect(isValidBucketName(name)).toBe(true);
  });

  it.each([
    ["ab", "too short"],
    ["A", "uppercase / length"],
    ["-foo", "leading hyphen"],
    ["foo-", "trailing hyphen"],
    ["192.168.1.1", "IP-like"],
    ["xn--foo", "xn-- prefix"],
    ["name-s3alias", "reserved suffix"],
  ])("rejects %s (%s)", (name) => {
    expect(isValidBucketName(name)).toBe(false);
  });
});

describe("bucketNameSchema", () => {
  it("parses valid names", () => {
    for (const name of ["alpha", "alpha-beta-1", "a1b"]) {
      expect(bucketNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("rejects invalid names with a clear message", () => {
    const cases: [string, string][] = [
      ["ab", "Must be at least 3 characters"],
      ["HELLO", "Use lowercase letters only"],
      ["-foo", "Use lowercase letters, digits, and hyphens"],
      ["foo-", "Use lowercase letters, digits, and hyphens"],
      ["192.168.1.1", "Use lowercase letters, digits, and hyphens"],
      ["xn--foo", "Must not start with 'xn--'"],
      ["name-s3alias", "Must not end with reserved suffix"],
    ];
    for (const [input, fragment] of cases) {
      const r = bucketNameSchema.safeParse(input);
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.message).toContain(fragment);
      }
    }
  });
});
