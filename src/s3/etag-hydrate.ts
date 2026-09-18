import type { FileEntry } from "../drime/types";
import type { AppContext } from "../server-context";
import { entryHasStrongContentEtag } from "./tagging";

const DEFAULT_HYDRATE_CONCURRENCY = 8;

/** Log at most one hydrate miss at warn so operators notice GET-by-id failures. */
let hydrateMissWarned = false;

function hydrateConcurrency(): number {
  const raw = process.env.DRIME_S3_ETAG_HYDRATE_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_HYDRATE_CONCURRENCY;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_HYDRATE_CONCURRENCY;
  return Math.min(Math.floor(n), 64);
}

/**
 * When Drive LIST omits the committed `md5:…` description (common after a
 * gateway restart), fetch the entry by id and soft-hold the strong metadata in
 * the replacement overlay so rclone `--checksum` can skip existing objects.
 */
export async function hydrateObjectEntry(
  ctx: AppContext,
  folderId: number | null,
  entry: FileEntry,
): Promise<FileEntry> {
  if (entry.is_folder || entryHasStrongContentEtag(entry)) return entry;

  try {
    const full = await ctx.drime.getFileEntry(entry.id);
    if (!entryHasStrongContentEtag(full)) return entry;
    const merged: FileEntry = {
      ...entry,
      description: full.description,
      hash: full.hash ?? entry.hash,
    };
    ctx.listCache.replaceEntry(folderId, entry.id, merged);
    return merged;
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    if (!hydrateMissWarned) {
      hydrateMissWarned = true;
      ctx.logger.warn({ entryId: entry.id, err }, "etag_hydrate_miss");
    } else if (typeof ctx.logger.debug === "function") {
      ctx.logger.debug({ entryId: entry.id, err }, "etag_hydrate_miss");
    }
    return entry;
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      results[i] = await fn(item);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Hydrate weak LIST rows in parallel (bounded) and soft-hold recovered ETags.
 */
export async function hydrateListingEtags(
  ctx: AppContext,
  folderId: number | null,
  entries: FileEntry[],
): Promise<FileEntry[]> {
  const concurrency = hydrateConcurrency();
  return mapPool(entries, concurrency, (entry) =>
    hydrateObjectEntry(ctx, folderId, entry),
  );
}
