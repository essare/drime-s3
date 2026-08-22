import { describe, expect, test } from "bun:test";
import { shouldBufferBodyForEtag } from "../../../src/s3/handlers/object";

describe("shouldBufferBodyForEtag", () => {
  const base = {
    hasStrongMetadata: false,
    size: 10 * 1024 * 1024,
    bufferMaxBytes: 64 * 1024 * 1024,
    hasRange: false,
    upstreamStatus: 200,
  };

  test("default (strongEtag false) never buffers", () => {
    expect(shouldBufferBodyForEtag({ ...base, strongEtag: false })).toBe(false);
  });

  test("strongEtag buffers weak metadata within max", () => {
    expect(shouldBufferBodyForEtag({ ...base, strongEtag: true })).toBe(true);
  });

  test("strongEtag skips when metadata already strong", () => {
    expect(
      shouldBufferBodyForEtag({
        ...base,
        strongEtag: true,
        hasStrongMetadata: true,
      }),
    ).toBe(false);
  });

  test("strongEtag skips Range and non-200", () => {
    expect(
      shouldBufferBodyForEtag({ ...base, strongEtag: true, hasRange: true }),
    ).toBe(false);
    expect(
      shouldBufferBodyForEtag({
        ...base,
        strongEtag: true,
        upstreamStatus: 206,
      }),
    ).toBe(false);
  });
});
