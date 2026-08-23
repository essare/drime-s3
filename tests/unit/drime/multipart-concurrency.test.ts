import { afterEach, describe, expect, test } from "bun:test";
import { getMultipartPartConcurrency } from "../../../src/drime/multipart-upload";

describe("getMultipartPartConcurrency", () => {
  const prev = process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY;
    } else {
      process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY = prev;
    }
  });

  test("defaults to 12 when unset", () => {
    delete process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY;
    expect(getMultipartPartConcurrency()).toBe(12);
  });

  test("reads positive env override", () => {
    process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY = "16";
    expect(getMultipartPartConcurrency()).toBe(16);
  });

  test("falls back to 12 on invalid env", () => {
    process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY = "nope";
    expect(getMultipartPartConcurrency()).toBe(12);
  });
});
