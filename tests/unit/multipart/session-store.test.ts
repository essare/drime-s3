import { describe, expect, test } from "bun:test";
import {
  decodeCompositeUploadId,
  encodeCompositeUploadId,
  MultipartSessionStore,
} from "../../../src/multipart/session-store";

describe("composite UploadId", () => {
  test("encode/decode round trip with v1 prefix", () => {
    const id = encodeCompositeUploadId("u-123", "photos/cat.png");
    expect(id.startsWith("v1.")).toBe(true);
    expect(decodeCompositeUploadId(id)).toEqual({
      uid: "u-123",
      key: "photos/cat.png",
    });
  });

  test("decodes legacy base64url JSON without v1 prefix", () => {
    const legacy = Buffer.from(
      JSON.stringify({ uid: "x", key: "k" }),
      "utf8",
    ).toString("base64url");
    expect(decodeCompositeUploadId(legacy)).toEqual({ uid: "x", key: "k" });
  });

  test("rejects invalid payload", () => {
    expect(() => decodeCompositeUploadId("not-base64!!!")).toThrow();
  });
});

describe("MultipartSessionStore", () => {
  test("evicts oldest when at cap", () => {
    let t = 0;
    const store = new MultipartSessionStore({ maxSessions: 2, now: () => t });
    store.set("a", {
      key: "k",
      bucket: "b",
      drimeUid: "u",
      drimeKey: "dk",
      parentId: 1,
      parts: [],
      createdAt: t,
    });
    t += 1;
    store.set("b", {
      key: "k",
      bucket: "b",
      drimeUid: "u2",
      drimeKey: "dk2",
      parentId: 1,
      parts: [],
      createdAt: t,
    });
    t += 1;
    store.set("c", {
      key: "k",
      bucket: "b",
      drimeUid: "u3",
      drimeKey: "dk3",
      parentId: 1,
      parts: [],
      createdAt: t,
    });
    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")).toBeDefined();
    expect(store.get("c")).toBeDefined();
    expect(store.size).toBe(2);
  });

  test("TTL drops session on get", () => {
    let t = 1000;
    const store = new MultipartSessionStore({ ttlMs: 5000, now: () => t });
    store.set("u1", {
      key: "k",
      bucket: "b",
      drimeUid: "ux",
      drimeKey: "dkx",
      parentId: 1,
      parts: [],
      createdAt: t,
    });
    t += 6000;
    expect(store.get("u1")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  test("update same id does not evict others", () => {
    const t0 = 1_700_000_000_000;
    const store = new MultipartSessionStore({ maxSessions: 2, now: () => t0 });
    store.set("a", {
      key: "k",
      bucket: "b",
      drimeUid: "ua",
      drimeKey: "dka",
      parentId: 1,
      parts: [],
      createdAt: t0,
    });
    store.set("b", {
      key: "k",
      bucket: "b",
      drimeUid: "ub",
      drimeKey: "dkb",
      parentId: 1,
      parts: [],
      createdAt: t0,
    });
    store.set("a", {
      key: "k2",
      bucket: "b",
      drimeUid: "ua",
      drimeKey: "dka",
      parentId: 1,
      parts: [{ partNumber: 1, size: 1, md5: "x", etag: "y" }],
      createdAt: t0,
    });
    expect(store.get("a")?.key).toBe("k2");
    expect(store.get("b")).toBeDefined();
  });
});
