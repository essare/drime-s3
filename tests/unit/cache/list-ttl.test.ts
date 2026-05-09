import { describe, expect, test } from "bun:test";
import {
  FolderPathCache,
  normalizePathKey,
} from "../../../src/cache/folder-paths";
import { ListTtlCache } from "../../../src/cache/list-ttl";
import type { FileEntry } from "../../../src/drime/types";

describe("FolderPathCache", () => {
  test("normalizePathKey lowercases and trims slashes", () => {
    expect(normalizePathKey("/Foo/Bar/")).toBe("foo/bar");
    expect(normalizePathKey("")).toBe("");
  });

  test("get/set", () => {
    const c = new FolderPathCache();
    c.set("My/Bucket", 42);
    expect(c.get("my/bucket")).toBe(42);
  });

  test("evictPrefix removes bucket subtree", () => {
    const c = new FolderPathCache();
    c.set("b1", 1);
    c.set("b1/a", 2);
    c.set("b2", 3);
    c.evictPrefix("b1");
    expect(c.get("b1")).toBeUndefined();
    expect(c.get("b1/a")).toBeUndefined();
    expect(c.get("b2")).toBe(3);
  });
});

describe("ListTtlCache single-flight", () => {
  test("two concurrent cold loads share one fetcher call", async () => {
    const cache = new ListTtlCache();
    let fetchCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const fetcher = async (): Promise<FileEntry[]> => {
      fetchCount += 1;
      await gate;
      return [];
    };

    const p1 = cache.getOrFetch(7, fetcher);
    const p2 = cache.getOrFetch(7, fetcher);
    expect(fetchCount).toBe(1);
    release();
    await expect(Promise.all([p1, p2])).resolves.toEqual([[], []]);
    expect(fetchCount).toBe(1);
  });

  test("second call within TTL uses cache (no fetcher)", async () => {
    const cache = new ListTtlCache();
    let fetchCount = 0;
    const fetcher = async (): Promise<FileEntry[]> => {
      fetchCount += 1;
      return [];
    };
    await cache.getOrFetch(null, fetcher);
    await cache.getOrFetch(null, fetcher);
    expect(fetchCount).toBe(1);
  });

  test("invalidate clears TTL entry", async () => {
    const cache = new ListTtlCache();
    let fetchCount = 0;
    const fetcher = async (): Promise<FileEntry[]> => {
      fetchCount += 1;
      return [];
    };
    await cache.getOrFetch(99, fetcher);
    cache.invalidate(99);
    await cache.getOrFetch(99, fetcher);
    expect(fetchCount).toBe(2);
  });
});
