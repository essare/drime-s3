import { afterEach, describe, expect, test } from "bun:test";
import {
  shouldBufferBodyForEtag,
  strongEtagEnabled,
} from "../../../src/s3/handlers/object";

describe("strongEtagEnabled", () => {
  const prev = process.env.DRIME_S3_STRONG_ETAG;

  afterEach(() => {
    if (prev === undefined) delete process.env.DRIME_S3_STRONG_ETAG;
    else process.env.DRIME_S3_STRONG_ETAG = prev;
  });

  test("defaults to true when unset (Duplicati-compatible)", () => {
    delete process.env.DRIME_S3_STRONG_ETAG;
    expect(strongEtagEnabled()).toBe(true);
  });

  test("can be disabled with 0/false", () => {
    process.env.DRIME_S3_STRONG_ETAG = "0";
    expect(strongEtagEnabled()).toBe(false);
    process.env.DRIME_S3_STRONG_ETAG = "false";
    expect(strongEtagEnabled()).toBe(false);
  });
});

describe("shouldBufferBodyForEtag", () => {
  const base = {
    hasStrongMetadata: false,
    size: 10 * 1024 * 1024,
    bufferMaxBytes: 64 * 1024 * 1024,
    hasRange: false,
    upstreamStatus: 200,
  };

  test("strongEtag false never buffers", () => {
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
