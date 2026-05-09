import { describe, expect, test } from "bun:test";
import { isValidBucketName, normalizeS3Key } from "../../../src/s3/naming";

describe("isValidBucketName", () => {
  test("accepts valid names", () => {
    expect(isValidBucketName("my-bucket-1")).toBe(true);
    expect(isValidBucketName("ab1")).toBe(true);
  });

  test("rejects uppercase", () => {
    expect(isValidBucketName("MyBucket")).toBe(false);
  });

  test("rejects IP-like", () => {
    expect(isValidBucketName("192.168.0.1")).toBe(false);
  });

  test("rejects too short", () => {
    expect(isValidBucketName("ab")).toBe(false);
  });

  test("rejects reserved prefixes/suffixes", () => {
    expect(isValidBucketName("xn--evil")).toBe(false);
    expect(isValidBucketName("foo-s3alias")).toBe(false);
    expect(isValidBucketName("a--ol-s3")).toBe(false);
  });

  test("rejects non-hyphen special chars", () => {
    expect(isValidBucketName("my_bucket")).toBe(false);
  });
});

describe("normalizeS3Key", () => {
  test("strips leading slashes and collapses", () => {
    expect(normalizeS3Key("//a//b/c")).toBe("a/b/c");
  });
});
