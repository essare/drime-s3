import { expect, test } from "bun:test";
import {
  mergeMetadata,
  readMetadata,
  serializeMetadata,
} from "../../../src/drime/metadata";

test("legacy md5: prefix", () => {
  expect(readMetadata("md5:abc")).toEqual({ md5: "abc" });
});

test("v1 json roundtrip", () => {
  const m = mergeMetadata(null, {
    md5: "deadbeef",
    ct: "text/plain",
    meta: { a: "1" },
  });
  const s = serializeMetadata(m);
  expect(readMetadata(s)).toMatchObject({
    v: 1,
    md5: "deadbeef",
    ct: "text/plain",
    meta: { a: "1" },
  });
});

test("free-form description is preserved read-only", () => {
  const raw = "User note about vacation photos";
  expect(readMetadata(raw)).toEqual({ description: raw });
  expect(mergeMetadata(raw, { md5: "x" })).toEqual({ description: raw }); // no merge into JSON per spec §7.3
});
