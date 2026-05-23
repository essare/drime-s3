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

const folderEntry = (id: number, name: string): FileEntry => ({
  id,
  name,
  parent_id: null,
  is_folder: true,
  file_size: 0,
  hash: null,
  mime: null,
  updated_at: null,
  created_at: null,
  description: null,
  url: null,
});

describe("ListTtlCache addEntry / removeEntryById", () => {
  test("addEntry on empty key is a no-op (next read fetches fresh)", async () => {
    const cache = new ListTtlCache();
    cache.addEntry(null, folderEntry(1, "alpha"));

    let fetchCount = 0;
    const fetcher = async (): Promise<FileEntry[]> => {
      fetchCount += 1;
      return [folderEntry(2, "beta")];
    };
    const entries = await cache.getOrFetch(null, fetcher);
    expect(fetchCount).toBe(1);
    expect(entries.map((e) => e.name)).toEqual(["beta"]);
  });

  test("addEntry on cached key appends without refetching", async () => {
    const cache = new ListTtlCache();
    let fetchCount = 0;
    const fetcher = async (): Promise<FileEntry[]> => {
      fetchCount += 1;
      return [folderEntry(1, "alpha")];
    };
    await cache.getOrFetch(null, fetcher);
    cache.addEntry(null, folderEntry(2, "beta"));

    const entries = await cache.getOrFetch(null, fetcher);
    expect(fetchCount).toBe(1);
    expect(entries.map((e) => e.name).sort()).toEqual(["alpha", "beta"]);
  });

  test("addEntry replaces an entry with the same id (idempotent)", async () => {
    const cache = new ListTtlCache();
    const fetcher = async (): Promise<FileEntry[]> => [folderEntry(1, "alpha")];
    await cache.getOrFetch(null, fetcher);
    cache.addEntry(null, { ...folderEntry(1, "alpha"), name: "renamed" });

    const entries = await cache.getOrFetch(null, fetcher);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("renamed");
  });

  test("addEntry refreshes TTL so the seeded entry survives the original window", async () => {
    const cache = new ListTtlCache();
    let fetchCount = 0;
    let upstream: FileEntry[] = [folderEntry(1, "alpha")];
    const fetcher = async (): Promise<FileEntry[]> => {
      fetchCount += 1;
      return upstream;
    };

    const t0 = Date.now();
    let nowSpy = t0;
    const realNow = Date.now;
    Date.now = () => nowSpy;
    try {
      await cache.getOrFetch(null, fetcher);
      // Fast-forward 4 s (still under 5 s TTL); seed at this moment.
      nowSpy = t0 + 4000;
      cache.addEntry(null, folderEntry(2, "beta"));
      // Original TTL would have expired at t0 + 5 s. Read at t0 + 8 s should
      // still hit cache because addEntry refreshed the timestamp.
      nowSpy = t0 + 8000;
      // Upstream still hasn't propagated the new entry — eventual consistency.
      upstream = [folderEntry(1, "alpha")];
      const entries = await cache.getOrFetch(null, fetcher);
      expect(fetchCount).toBe(1);
      expect(entries.map((e) => e.name).sort()).toEqual(["alpha", "beta"]);
    } finally {
      Date.now = realNow;
    }
  });

  test("removeEntryById drops the matching entry from the cached listing", async () => {
    const cache = new ListTtlCache();
    let fetchCount = 0;
    const fetcher = async (): Promise<FileEntry[]> => {
      fetchCount += 1;
      return [folderEntry(1, "alpha"), folderEntry(2, "beta")];
    };
    await cache.getOrFetch(null, fetcher);
    cache.removeEntryById(null, 1);

    const entries = await cache.getOrFetch(null, fetcher);
    expect(fetchCount).toBe(1);
    expect(entries.map((e) => e.id)).toEqual([2]);
  });

  test("removeEntryById on missing id is a no-op", async () => {
    const cache = new ListTtlCache();
    const fetcher = async (): Promise<FileEntry[]> => [folderEntry(1, "alpha")];
    await cache.getOrFetch(null, fetcher);
    cache.removeEntryById(null, 999);
    const entries = await cache.getOrFetch(null, fetcher);
    expect(entries.map((e) => e.id)).toEqual([1]);
  });

  test("removeEntryById on empty key is a no-op", () => {
    const cache = new ListTtlCache();
    expect(() => {
      cache.removeEntryById(null, 1);
    }).not.toThrow();
  });
});
