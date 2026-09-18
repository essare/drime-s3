import { describe, expect, test } from "bun:test";
import { FolderPathCache } from "../../../src/cache/folder-paths";
import { ListTtlCache } from "../../../src/cache/list-ttl";
import type { FileEntry } from "../../../src/drime/types";
import { hydrateListingEtags } from "../../../src/s3/etag-hydrate";
import { resolveObjectKey } from "../../../src/s3/handlers/object-resolve";
import {
  entryHasStrongContentEtag,
  etagFromFileEntry,
} from "../../../src/s3/tagging";
import type { AppContext } from "../../../src/server-context";

function fileEntry(
  id: number,
  name: string,
  description: string | null = null,
): FileEntry {
  return {
    id,
    name,
    parent_id: 7,
    is_folder: false,
    file_size: 4,
    hash: null,
    mime: "application/octet-stream",
    updated_at: null,
    created_at: null,
    description,
    url: null,
  };
}

describe("cold ETag hydration after process restart", () => {
  test("LIST-shaped rows without overlay recover committed description via getFileEntry", async () => {
    const weak = fileEntry(33, "backup.bin", null);
    const committed = fileEntry(
      33,
      "backup.bin",
      "md5:cccccccccccccccccccccccccccccccc-41",
    );
    let getCalls = 0;
    const listCache = new ListTtlCache();
    const ctx = {
      listCache,
      folderCache: new FolderPathCache(),
      drime: {
        listFolder: async () => [weak],
        getFileEntry: async (id: number) => {
          getCalls += 1;
          expect(id).toBe(33);
          return committed;
        },
      },
      logger: {
        error() {},
        warn() {},
        info() {},
        debug() {},
      },
    } as unknown as AppContext;

    // Cold process: no replacement overlay from a prior upload.
    expect(listCache.replacementOverlaySize).toBe(0);

    const listed = await listCache.getOrFetch(7, () =>
      ctx.drime.listFolder(7, 1),
    );
    const hydrated = await hydrateListingEtags(ctx, 7, listed);

    expect(getCalls).toBe(1);
    expect(hydrated).toHaveLength(1);
    const row = hydrated[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(entryHasStrongContentEtag(row)).toBe(true);
    expect(etagFromFileEntry(row)).toBe(
      '"cccccccccccccccccccccccccccccccc-41"',
    );
    // Remembered description must not consume create-first overlay budget.
    expect(listCache.replacementOverlaySize).toBe(0);
    expect(listCache.strongDescriptionSize).toBe(1);

    // Later cold LIST still serves the remembered ETag without re-fetch.
    listCache.invalidate(7);
    getCalls = 0;
    const again = await listCache.getOrFetch(7, () =>
      ctx.drime.listFolder(7, 1),
    );
    expect(getCalls).toBe(0);
    const againRow = again[0];
    expect(againRow).toBeDefined();
    if (!againRow) return;
    expect(etagFromFileEntry(againRow)).toBe(
      '"cccccccccccccccccccccccccccccccc-41"',
    );
  });

  test("resolveObjectKey recovers committed ETag on cold HEAD path", async () => {
    const weak = fileEntry(33, "backup.bin", null);
    const committed = fileEntry(
      33,
      "backup.bin",
      "md5:dddddddddddddddddddddddddddddddd-13",
    );
    const listCache = new ListTtlCache();
    const ctx = {
      listCache,
      folderCache: new FolderPathCache(),
      drime: {
        listFolder: async () => [weak],
        getFileEntry: async () => committed,
      },
      logger: {
        error() {},
        warn() {},
        info() {},
        debug() {},
      },
    } as unknown as AppContext;

    const resolved = await resolveObjectKey(
      ctx,
      1,
      7,
      "dup-bucket",
      "backup.bin",
    );
    expect(resolved.kind).toBe("file");
    if (resolved.kind !== "file") return;

    expect(entryHasStrongContentEtag(resolved.entry)).toBe(true);
    expect(etagFromFileEntry(resolved.entry)).toBe(
      '"dddddddddddddddddddddddddddddddd-13"',
    );
  });

  test("skips getFileEntry when LIST already carries a strong description", async () => {
    const strong = fileEntry(
      33,
      "backup.bin",
      "md5:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    let getCalls = 0;
    const ctx = {
      listCache: new ListTtlCache(),
      folderCache: new FolderPathCache(),
      drime: {
        listFolder: async () => [strong],
        getFileEntry: async () => {
          getCalls += 1;
          throw new Error("should not fetch");
        },
      },
      logger: { error() {}, warn() {}, info() {}, debug() {} },
    } as unknown as AppContext;

    const listed = await ctx.listCache.getOrFetch(7, () =>
      ctx.drime.listFolder(7, 1),
    );
    const hydrated = await hydrateListingEtags(ctx, 7, listed);
    expect(getCalls).toBe(0);
    const row = hydrated[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(etagFromFileEntry(row)).toBe('"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
  });
});
