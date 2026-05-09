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
