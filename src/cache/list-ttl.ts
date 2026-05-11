import type { FileEntry } from "../drime/types";

const TTL_MS = 5000;
const MAX_CACHED_KEYS = 5000;

function cacheKey(folderId: number | null): string {
  return folderId === null ? "__root__" : String(folderId);
}

type Cached = { ts: number; entries: FileEntry[] };

/**
 * Short-TTL list cache with single-flight coalescing per folder id (spec §10.2).
 */
export class ListTtlCache {
  private readonly cache = new Map<string, Cached>();
  private readonly inflight = new Map<string, Promise<FileEntry[]>>();

  /** Drop cached listing for this folder (call after writes under that folder). */
  invalidate(folderId: number | null): void {
    this.cache.delete(cacheKey(folderId));
  }

  /**
   * Splice an entry into a cached listing for read-your-writes semantics under
   * upstream eventual consistency. Replaces an existing entry with the same id
   * (idempotent) or appends a new one. Refreshes the cache timestamp so the
   * seeded entry survives the original TTL window. No-op when the listing is
   * not currently cached — the next read will fetch fresh from upstream.
   */
  addEntry(folderId: number | null, entry: FileEntry): void {
    const cached = this.cache.get(cacheKey(folderId));
    if (!cached) return;
    const idx = cached.entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) cached.entries[idx] = entry;
    else cached.entries.push(entry);
    cached.ts = Date.now();
  }

  /**
   * Remove an entry by id from a cached listing for read-your-writes semantics
   * after a delete. No-op when the listing is not cached or the id is absent.
   * Refreshes the cache timestamp on hit so the post-delete view survives the
   * original TTL window.
   */
  removeEntryById(folderId: number | null, id: number): void {
    const cached = this.cache.get(cacheKey(folderId));
    if (!cached) return;
    const before = cached.entries.length;
    cached.entries = cached.entries.filter((e) => e.id !== id);
    if (cached.entries.length !== before) cached.ts = Date.now();
  }

  private trimIfNeeded(): void {
    while (this.cache.size > MAX_CACHED_KEYS) {
      const first = this.cache.keys().next().value;
      if (first === undefined) break;
      this.cache.delete(first);
    }
  }

  async getOrFetch(
    folderId: number | null,
    fetcher: () => Promise<FileEntry[]>,
  ): Promise<FileEntry[]> {
    const k = cacheKey(folderId);
    const now = Date.now();
    const hit = this.cache.get(k);
    if (hit && now - hit.ts < TTL_MS) {
      return hit.entries;
    }

    let pending = this.inflight.get(k);
    if (!pending) {
      pending = this.runFetch(k, fetcher);
      this.inflight.set(k, pending);
    }

    return await pending;
  }

  private runFetch(
    k: string,
    fetcher: () => Promise<FileEntry[]>,
  ): Promise<FileEntry[]> {
    return (async () => {
      try {
        const entries = await fetcher();
        this.cache.set(k, { ts: Date.now(), entries });
        this.trimIfNeeded();
        return entries;
      } finally {
        this.inflight.delete(k);
      }
    })();
  }

  get size(): number {
    return this.cache.size;
  }

  get inflightSize(): number {
    return this.inflight.size;
  }
}
