import type { FileEntry } from "../drime/types";

const TTL_MS = 5000;
const MAX_CACHED_KEYS = 5000;
const REPLACEMENT_OVERLAY_MS = 60_000;

function cacheKey(folderId: number | null): string {
  return folderId === null ? "__root__" : String(folderId);
}

type Cached = { ts: number; entries: FileEntry[] };

type ReplacementOverlay = {
  oldEntryId?: number;
  newEntry: FileEntry;
  expiresAt: number;
};

export type ReplacementOverlayExpired = {
  folderId: number | null;
  name: string;
  oldEntryId?: number;
  newEntryId: number;
};

/**
 * Short-TTL list cache with single-flight coalescing per folder id (spec §10.2).
 */
export class ListTtlCache {
  private readonly cache = new Map<string, Cached>();
  private readonly inflight = new Map<string, Promise<FileEntry[]>>();
  private readonly replacements = new Map<
    string,
    Map<string, ReplacementOverlay>
  >();
  private readonly replacementOrder = new Map<
    ReplacementOverlay,
    { folderKey: string; name: string }
  >();

  constructor(
    private readonly onReplacementExpired: (
      event: ReplacementOverlayExpired,
    ) => void = () => {},
  ) {}

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

  replaceEntry(
    folderId: number | null,
    oldEntryId: number | undefined,
    newEntry: FileEntry,
  ): void {
    const k = cacheKey(folderId);
    let folderReplacements = this.replacements.get(k);
    if (!folderReplacements) {
      folderReplacements = new Map();
      this.replacements.set(k, folderReplacements);
    }
    const previous = folderReplacements.get(newEntry.name);
    if (previous) this.replacementOrder.delete(previous);
    const replacement = {
      oldEntryId,
      newEntry,
      expiresAt: Date.now() + REPLACEMENT_OVERLAY_MS,
    };
    folderReplacements.set(newEntry.name, replacement);
    this.replacementOrder.set(replacement, {
      folderKey: k,
      name: newEntry.name,
    });
    this.trimReplacementsIfNeeded();
  }

  private trimIfNeeded(): void {
    while (this.cache.size > MAX_CACHED_KEYS) {
      const first = this.cache.keys().next().value;
      if (first === undefined) break;
      this.cache.delete(first);
    }
  }

  private trimReplacementsIfNeeded(): void {
    while (this.replacementOrder.size > MAX_CACHED_KEYS) {
      const first = this.replacementOrder.keys().next().value;
      if (first === undefined) break;
      this.deleteReplacement(first);
    }
  }

  private deleteReplacement(replacement: ReplacementOverlay): void {
    const location = this.replacementOrder.get(replacement);
    if (!location) return;
    this.replacementOrder.delete(replacement);

    const folderReplacements = this.replacements.get(location.folderKey);
    if (folderReplacements?.get(location.name) !== replacement) return;
    folderReplacements.delete(location.name);
    if (folderReplacements.size === 0) {
      this.replacements.delete(location.folderKey);
    }
  }

  private mergeReplacement(
    rows: FileEntry[],
    replacement: ReplacementOverlay,
  ): FileEntry[] {
    return [
      ...rows.filter(
        (row) =>
          row.id !== replacement.oldEntryId &&
          row.name !== replacement.newEntry.name,
      ),
      replacement.newEntry,
    ];
  }

  private applyReplacements(
    k: string,
    rows: FileEntry[],
    reconcile: boolean,
  ): FileEntry[] {
    const folderReplacements = this.replacements.get(k);
    if (!folderReplacements) return [...rows];

    let merged = [...rows];
    const now = Date.now();
    for (const [name, replacement] of folderReplacements) {
      if (replacement.expiresAt <= now) {
        this.deleteReplacement(replacement);
        this.onReplacementExpired({
          folderId: k === "__root__" ? null : Number(k),
          name,
          oldEntryId: replacement.oldEntryId,
          newEntryId: replacement.newEntry.id,
        });
        continue;
      }

      if (reconcile) {
        const hasNewEntry = rows.some(
          (row) => row.id === replacement.newEntry.id,
        );
        const hasOldEntry =
          replacement.oldEntryId !== undefined &&
          rows.some((row) => row.id === replacement.oldEntryId);
        if (hasNewEntry && !hasOldEntry) {
          this.deleteReplacement(replacement);
          continue;
        }
      }

      merged = this.mergeReplacement(merged, replacement);
    }

    return merged;
  }

  private pruneExpiredReplacements(): void {
    for (const k of this.replacements.keys()) {
      this.applyReplacements(k, [], false);
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
      return this.applyReplacements(k, hit.entries, false);
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
        const rawEntries = await fetcher();
        const entries = this.applyReplacements(k, rawEntries, true);
        this.cache.set(k, { ts: Date.now(), entries: rawEntries });
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

  get replacementOverlaySize(): number {
    this.pruneExpiredReplacements();
    return this.replacementOrder.size;
  }
}
