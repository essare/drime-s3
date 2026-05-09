import { describe, expect, it } from "vitest";

import { buildObjectUrl } from "./object-url";

describe("buildObjectUrl", () => {
  it("builds URL for a plain key", () => {
    expect(buildObjectUrl("alpha", "file.txt")).toBe(
      "/_admin/buckets/alpha/objects/file.txt",
    );
  });

  it("preserves slashes between nested segments", () => {
    expect(buildObjectUrl("alpha", "a/b/c.txt")).toBe(
      "/_admin/buckets/alpha/objects/a/b/c.txt",
    );
  });

  it("encodes special characters per segment", () => {
    expect(buildObjectUrl("alpha", "a b/c?d.txt")).toBe(
      "/_admin/buckets/alpha/objects/a%20b/c%3Fd.txt",
    );
  });

  it("encodes bucket name as a single path segment", () => {
    expect(buildObjectUrl("alpha-bucket", "x.txt")).toBe(
      "/_admin/buckets/alpha-bucket/objects/x.txt",
    );
  });
});
