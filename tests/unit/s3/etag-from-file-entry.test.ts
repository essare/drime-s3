import { describe, expect, test } from "bun:test";
import type { FileEntry } from "../../../src/drime/types";
import {
  entryHasStrongContentEtag,
  etagFromFileEntry,
} from "../../../src/s3/tagging";

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
  test("uses multipart composite md5 line from description", () => {
    const hex32 = "abcd".repeat(8);
    const e = entry({
      description: `md5:${hex32}-4\n`,
    });
    expect(etagFromFileEntry(e)).toBe(`"${hex32}-4"`);
  });

  test("entryHasStrongContentEtag is false for opaque hash only", () => {
    const e = entry({
      description: null,
      hash: "NzE1NDg5Njk0fA",
    });
    expect(entryHasStrongContentEtag(e)).toBe(false);
  });

  test("entryHasStrongContentEtag is true for md5 line", () => {
    expect(
      entryHasStrongContentEtag(
        entry({ description: "md5:abcdabcdabcdabcdabcdabcdabcdabcd\n" }),
      ),
    ).toBe(true);
  });

  test("entryHasStrongContentEtag is true for hex hash", () => {
    expect(
      entryHasStrongContentEtag(
        entry({
          hash: "fedcba0987654321fedcba0987654321",
        }),
      ),
    ).toBe(true);
  });

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

  test("ignores opaque non-hex hash (Drime), uses synthetic 32-hex etag", () => {
    const e = entry({
      id: 715489694,
      name: "duplicati-access-privileges-test.tmp",
      file_size: 84,
      updated_at: "2026-05-11T21:59:23.000Z",
      description: null,
      hash: "NzE1NDg5Njk0fA",
    });
    expect(etagFromFileEntry(e)).toMatch(/^"[a-f0-9]{32}"$/);
    expect(etagFromFileEntry(e)).toBe(etagFromFileEntry(e));
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
