import { describe, expect, test } from "bun:test";
import {
  CreatedEntryError,
  parseCreatedFileEntry,
} from "../../../src/drime/created-entry";

const fallback = {
  name: "backup.bin",
  parentId: 41,
  size: 123,
  mime: "application/octet-stream",
  description: "md5:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

describe("parseCreatedFileEntry", () => {
  for (const [label, raw] of [
    ["fileEntry", { fileEntry: { id: 7, name: "backup.bin" } }],
    ["file", { file: { id: 7, name: "backup.bin" } }],
    ["entry", { entry: { id: 7, name: "backup.bin" } }],
    ["data", { data: { id: 7, name: "backup.bin" } }],
    ["direct", { id: 7, name: "backup.bin" }],
    ["decimal string id", { fileEntry: { id: "7", name: "backup.bin" } }],
  ] as const) {
    test(`accepts ${label}`, () => {
      const entry = parseCreatedFileEntry(raw, fallback);
      expect(entry.id).toBe(7);
      expect(entry.parent_id).toBe(41);
      expect(entry.file_size).toBe(123);
      expect(entry.description).toBe(fallback.description);
    });
  }

  test("rejects a response without a positive entry id", () => {
    expect(() => parseCreatedFileEntry({ status: "ok" }, fallback)).toThrow(
      CreatedEntryError,
    );
    expect(() =>
      parseCreatedFileEntry({ fileEntry: { id: 0 } }, fallback),
    ).toThrow(CreatedEntryError);
  });
});
