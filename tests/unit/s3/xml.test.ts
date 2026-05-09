import { describe, expect, test } from "bun:test";
import { XMLParser } from "fast-xml-parser";
import { s3ErrorXml } from "../../../src/s3/errors";
import {
  copyObjectResultXml,
  deleteResultXml,
  listAllMyBucketsXml,
  listBucketResultXml,
} from "../../../src/s3/xml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

describe("s3ErrorXml", () => {
  test("builds Error with xmlns", () => {
    const xml = s3ErrorXml("NoSuchKey", "missing");
    expect(xml).toContain("NoSuchKey");
    expect(xml).toContain("missing");
    expect(xml).toContain("http://s3.amazonaws.com/doc/2006-03-01/");
  });
});

describe("listAllMyBucketsXml", () => {
  test("includes buckets", () => {
    const xml = listAllMyBucketsXml({
      ownerId: "x",
      ownerDisplayName: "y",
      buckets: [{ name: "b1", creationDate: "2023-01-01T00:00:00.000Z" }],
    });
    const j = parser.parse(xml) as {
      ListAllMyBucketsResult?: { Buckets?: unknown };
    };
    expect(j.ListAllMyBucketsResult).toBeDefined();
  });
});

describe("listBucketResultXml", () => {
  test("V2 fields optional", () => {
    const xml = listBucketResultXml({
      name: "b",
      prefix: "",
      keyCount: 0,
      maxKeys: 1000,
      isTruncated: false,
      nextContinuationToken: "abc",
    });
    expect(xml).toContain("NextContinuationToken");
    expect(xml).toContain("abc");
  });
});

describe("deleteResultXml", () => {
  test("deleted keys", () => {
    const xml = deleteResultXml([{ Key: "a" }], []);
    expect(xml).toContain("a");
  });
});

describe("copyObjectResultXml", () => {
  test("etag", () => {
    const xml = copyObjectResultXml({
      etag: '"x"',
      lastModified: "2023-01-01T00:00:00.000Z",
    });
    expect(xml).toContain("x");
  });
});
