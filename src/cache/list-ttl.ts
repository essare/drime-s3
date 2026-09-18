import type { FileEntry } from "../drime/types";

const TTL_MS = 5000;
const MAX_CACHED_KEYS = 5000;
const MAX_STRONG_DESCRIPTIONS = 20_000;
const REPLACEMENT_OVERLAY_MS = 60_000;

function cacheKey(folderId: number | null): string {
  return folderId === null ? "__root__" : String(folderId);
}

type Cached = { ts: number; entries: FileEntry[] };

type ReplacementOverlay = {
  oldEntryId?: number;
  newEntry: FileEntry;
  expiresAt: number;
  /** Soft-TTL expiry callback fires at most once per overlay. */
  expiredNotified?: boolean;
};

/** True when the upstream row for the candidate has the overlay's description. */
function upstreamCarriesCommittedDescription(
  rows: FileEntry[],
  replacement: ReplacementOverlay,
): boolean {
  const upstream = rows.find((row) => row.id === replacement.newEntry.id);
  if (!upstream) return false;
  return (
    (upstream.description ?? null) ===
    (replacement.newEntry.description ?? null)
  );
}

function descriptionLooksStrong(description: string | null): boolean {
  const first = description?.split("\n")[0]?.trim() ?? "";
  if (!first.startsWith("md5:")) return false;
  const rest = first.slice(4).replace(/\s+/g, "").toLowerCase();
  return /^[a-f0-9]{32}(-\d+)?$/.test(rest);
}

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
  /**
   * Committed ETag descriptions recovered after LIST omits them (e.g. cold
   * restart hydrate). Separate from replacement overlays so enrichment cannot
   * starve or thrash the create-first overlay budget.
   */
  private readonly strongDescriptions = new Map<number, string>();

  constructor(
    private readonly onReplacementExpired: (
      event: ReplacementOverlayExpired,
    ) => void = () => {},
    private readonly onReplacementEvicted: (
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
    if (descriptionLooksStrong(entry.description)) {
      this.rememberStrongDescription(entry.id, entry.description as string);
    }
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
    this.strongDescriptions.delete(id);
  }

  /**
   * Remember a committed `md5:…` description for an entry id so cold LIST/HEAD
   * keep a strong ETag after gateway restart without consuming replacement
   * overlay slots.
   */
  rememberStrongDescription(entryId: number, description: string): void {
    if (!descriptionLooksStrong(description)) return;
    if (this.strongDescriptions.has(entryId)) {
      this.strongDescriptions.delete(entryId);
    }
    this.strongDescriptions.set(entryId, description);
    while (this.strongDescriptions.size > MAX_STRONG_DESCRIPTIONS) {
      const oldest = this.strongDescriptions.keys().next().value;
      if (oldest === undefined) break;
      this.strongDescriptions.delete(oldest);
    }
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
    const replacement: ReplacementOverlay = {
      oldEntryId,
      newEntry,
      expiresAt: Date.now() + REPLACEMENT_OVERLAY_MS,
    };
    folderReplacements.set(newEntry.name, replacement);
    this.replacementOrder.set(replacement, {
      folderKey: k,
      name: newEntry.name,
    });
    if (descriptionLooksStrong(newEntry.description)) {
      this.rememberStrongDescription(
        newEntry.id,
        newEntry.description as string,
      );
    }
    if (oldEntryId !== undefined) this.strongDescriptions.delete(oldEntryId);
    this.trimReplacementsIfNeeded();
  }

  /**
   * Drop the replacement overlay for `name` in this folder. S3 object delete
   * must call this so a create-first overlay cannot resurrect a deleted key.
   */
  clearReplacement(folderId: number | null, name: string): void {
    const folderReplacements = this.replacements.get(cacheKey(folderId));
    const replacement = folderReplacements?.get(name);
    if (replacement) this.deleteReplacement(replacement);
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
      const location = this.replacementOrder.get(first);
      const evicted = location
        ? {
            folderId:
              location.folderKey === "__root__"
                ? null
                : Number(location.folderKey),
            name: location.name,
            oldEntryId: first.oldEntryId,
            newEntryId: first.newEntry.id,
          }
        : undefined;
      this.deleteReplacement(first);
      if (evicted) this.onReplacementEvicted(evicted);
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

  private applyStrongDescriptions(rows: FileEntry[]): FileEntry[] {
    if (this.strongDescriptions.size === 0) return rows;
    return rows.map((row) => {
      if (row.is_folder || descriptionLooksStrong(row.description)) {
        return row;
      }
      const remembered = this.strongDescriptions.get(row.id);
      if (!remembered) return row;
      return { ...row, description: remembered };
    });
  }

  private applyReplacements(
    k: string,
    rows: FileEntry[],
    reconcile: boolean,
  ): FileEntry[] {
    const folderReplacements = this.replacements.get(k);
    if (!folderReplacements) {
      return this.applyStrongDescriptions([...rows]);
    }

    let merged = [...rows];
    const now = Date.now();
    for (const [name, replacement] of folderReplacements) {
      if (reconcile) {
        const hasNewEntry = rows.some(
          (row) => row.id === replacement.newEntry.id,
        );
        const hasOldEntry =
          replacement.oldEntryId !== undefined &&
          rows.some((row) => row.id === replacement.oldEntryId);
        /**
         * Only drop the overlay once upstream has converged *and* carries the
         * committed ETag description. Drime list payloads often show the new
         * id before `PUT /file-entries/:id` description is visible; dropping
         * early makes HEAD return a synthetic plain MD5 and rclone fails with
         * `md5 hashes differ` / `Etag differ: expecting …-N`.
         */
        if (
          hasNewEntry &&
          !hasOldEntry &&
          upstreamCarriesCommittedDescription(rows, replacement)
        ) {
          this.deleteReplacement(replacement);
          continue;
        }
      }

      /**
       * Soft TTL: do not drop the overlay when the window elapses while LIST
       * still omits the committed description (common for hours on cold
       * re-LIST). Extend the window and warn once so a long sync / cold
       * re-sync keeps the ETag rclone already verified without flooding logs
       * (e.g. every /_health probe).
       */
      if (replacement.expiresAt <= now) {
        if (
          reconcile &&
          upstreamCarriesCommittedDescription(rows, replacement)
        ) {
          this.deleteReplacement(replacement);
          continue;
        }
        if (!replacement.expiredNotified) {
          replacement.expiredNotified = true;
          this.onReplacementExpired({
            folderId: k === "__root__" ? null : Number(k),
            name,
            oldEntryId: replacement.oldEntryId,
            newEntryId: replacement.newEntry.id,
          });
        }
        replacement.expiresAt = now + REPLACEMENT_OVERLAY_MS;
      }

      merged = this.mergeReplacement(merged, replacement);
    }

    return this.applyStrongDescriptions(merged);
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

  /** Active create-first replacement overlays (no prune side effects). */
  get replacementOverlaySize(): number {
    return this.replacementOrder.size;
  }

  /** Remembered strong descriptions for cold LIST/HEAD ETag recovery. */
  get strongDescriptionSize(): number {
    return this.strongDescriptions.size;
  }
}
