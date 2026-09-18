import { describe, expect, test } from "bun:test";
import { FolderPathCache } from "../../../src/cache/folder-paths";
import { ListTtlCache } from "../../../src/cache/list-ttl";
import type { FileEntry } from "../../../src/drime/types";
import {
  ambiguousMutationError,
  readableObjectEntry,
  resolveObjectKey,
} from "../../../src/s3/handlers/object-resolve";
import type { AppContext } from "../../../src/server-context";

function fileEntry(id: number, name: string, parentId = 7): FileEntry {
  return {
    id,
    name,
    parent_id: parentId,
    is_folder: false,
    file_size: 4,
    hash: null,
    mime: "application/octet-stream",
    updated_at: null,
    created_at: null,
    description: null,
    url: null,
  };
}

function ctxWithListing(rows: FileEntry[]): AppContext {
  const listCache = new ListTtlCache();
  return {
    listCache,
    folderCache: new FolderPathCache(),
    drime: {
      listFolder: async () => rows,
    },
    logger: {
      error() {},
    },
  } as unknown as AppContext;
}

describe("resolveObjectKey duplicates", () => {
  test("reports ambiguous when raw listing has two exact-name files", async () => {
    const first = fileEntry(11, "backup.bin");
    const second = fileEntry(22, "backup.bin");
    const ctx = ctxWithListing([first, second]);

    const resolved = await resolveObjectKey(
      ctx,
      1,
      7,
      "dup-bucket",
      "backup.bin",
    );

    expect(resolved.kind).toBe("ambiguous");
    if (resolved.kind !== "ambiguous") return;
    expect(resolved.parentFolderId).toBe(7);
    expect(resolved.leafName).toBe("backup.bin");
    expect(resolved.entries.map((e) => e.id)).toEqual([11, 22]);
  });

  test("prefers an active overlay that collapsed the same-name rows", async () => {
    const oldEntry = fileEntry(11, "backup.bin");
    const staleTwin = fileEntry(22, "backup.bin");
    const overlayEntry = fileEntry(33, "backup.bin");
    const ctx = ctxWithListing([oldEntry, staleTwin]);
    ctx.listCache.replaceEntry(7, oldEntry.id, overlayEntry);

    const resolved = await resolveObjectKey(
      ctx,
      1,
      7,
      "dup-bucket",
      "backup.bin",
    );

    expect(resolved).toEqual({
      kind: "file",
      entry: overlayEntry,
      parentFolderId: 7,
    });
  });

  test("keeps committed ETag description when upstream list omits it after converge", async () => {
    const oldEntry = fileEntry(11, "backup.bin");
    const committed: FileEntry = {
      ...fileEntry(33, "backup.bin"),
      description: "md5:cccccccccccccccccccccccccccccccc-41",
    };
    const upstreamWeak: FileEntry = {
      ...fileEntry(33, "backup.bin"),
      description: null,
    };
    const listCache = new ListTtlCache();
    const ctx = {
      listCache,
      folderCache: new FolderPathCache(),
      drime: {
        listFolder: async () => [upstreamWeak],
      },
      logger: {
        error() {},
      },
    } as unknown as AppContext;
    listCache.replaceEntry(7, oldEntry.id, committed);

    const resolved = await resolveObjectKey(
      ctx,
      1,
      7,
      "dup-bucket",
      "backup.bin",
    );

    expect(resolved).toEqual({
      kind: "file",
      entry: committed,
      parentFolderId: 7,
    });
  });

  test("keeps committed ETag after overlay expiry when upstream list still omits description", async () => {
    const { entryHasStrongContentEtag, etagFromFileEntry } = await import(
      "../../../src/s3/tagging"
    );
    const oldEntry = fileEntry(11, "backup.bin");
    const committed: FileEntry = {
      ...fileEntry(33, "backup.bin"),
      description: "md5:cccccccccccccccccccccccccccccccc-41",
    };
    const upstreamWeak: FileEntry = {
      ...fileEntry(33, "backup.bin"),
      description: null,
    };
    const listCache = new ListTtlCache();
    const ctx = {
      listCache,
      folderCache: new FolderPathCache(),
      drime: {
        listFolder: async () => [upstreamWeak],
      },
      logger: {
        error() {},
      },
    } as unknown as AppContext;

    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      listCache.replaceEntry(7, oldEntry.id, committed);
      // Cold boundary: overlay TTL elapsed; only weak LIST remains.
      now += 60_000;

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
        '"cccccccccccccccccccccccccccccccc-41"',
      );
    } finally {
      Date.now = realNow;
    }
  });

  test("readableObjectEntry stays available on ambiguous duplicates", () => {
    const first = fileEntry(11, "backup.bin");
    const second = fileEntry(22, "backup.bin");
    const readable = readableObjectEntry({
      kind: "ambiguous",
      entries: [first, second],
      parentFolderId: 7,
      leafName: "backup.bin",
    });
    expect(readable?.entry.id).toBe(11);
  });

  test("ambiguousMutationError is static InternalError with safe log fields", async () => {
    const fields: Array<{ payload: Record<string, unknown>; message: string }> =
      [];
    const ctx = {
      logger: {
        error(payload: Record<string, unknown>, message: string) {
          fields.push({ payload, message });
        },
      },
    } as unknown as AppContext;
    const response = ambiguousMutationError(ctx, "dup-bucket", "backup.bin", {
      kind: "ambiguous",
      entries: [fileEntry(11, "backup.bin"), fileEntry(22, "backup.bin")],
      parentFolderId: 7,
      leafName: "backup.bin",
    });
    expect(response.status).toBe(500);
    const xml = await response.text();
    expect(xml).toContain("InternalError");
    expect(xml).toContain("Object key is ambiguous.");
    expect(xml).not.toContain("11");
    expect(xml).not.toContain("22");
    expect(fields).toEqual([
      {
        payload: {
          bucket: "dup-bucket",
          key: "backup.bin",
          parentFolderId: 7,
          entryIds: [11, 22],
        },
        message: "ambiguous_object_key",
      },
    ]);
  });
});
