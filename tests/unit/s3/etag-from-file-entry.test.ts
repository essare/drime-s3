import { describe, expect, test } from "bun:test";
import type { FileEntry } from "../../../src/drime/types";
import { etagFromFileEntry } from "../../../src/s3/tagging";

function entry(partial: Partial<FileEntry>): FileEntry {
  return {
    id: 1,
    name: "x",
    parent_id: null,
    is_folder: false,
    file_size: 0,
    hash: null,
    mime: null,
    updated_at: null,
    description: null,
    url: null,
    ...partial,
  };
}

describe("etagFromFileEntry", () => {
  test("uses md5 line from description", () => {
    const e = entry({
      description: "md5:abcdef0123456789abcdef0123456789\n",
    });
    expect(etagFromFileEntry(e)).toBe('"abcdef0123456789abcdef0123456789"');
  });

  test("uses entry.hash when no md5 line", () => {
    const e = entry({
      description: null,
      hash: "fedcba0987654321fedcba0987654321",
    });
    expect(etagFromFileEntry(e)).toBe('"fedcba0987654321fedcba0987654321"');
  });

  test("synthetic 32-hex etag when no md5 and no hash", () => {
    const e = entry({
      id: 42,
      name: "duplicati-access-privileges-test.tmp",
      file_size: 3,
      updated_at: "2026-01-15T10:00:00.000Z",
      description: null,
      hash: null,
    });
    expect(etagFromFileEntry(e)).toMatch(/^"[a-f0-9]{32}"$/);
    expect(etagFromFileEntry(e)).toBe(etagFromFileEntry(e));
  });
});
