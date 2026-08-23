import { describe, expect, test } from "bun:test";
import { FolderPathCache } from "../../../src/cache/folder-paths";
import type { FileEntry } from "../../../src/drime/types";
import { ensureParentFolderForPut } from "../../../src/s3/handlers/object";
import type { AppContext } from "../../../src/server-context";

const folderEntry = (
  id: number,
  name: string,
  parentId: number,
): FileEntry => ({
  id,
  name,
  parent_id: parentId,
  is_folder: true,
  file_size: 0,
  hash: null,
  mime: null,
  updated_at: null,
  created_at: null,
  description: null,
  url: null,
});

describe("ensureParentFolderForPut", () => {
  test("uses folderCache and skips listCache when path segments are warm", async () => {
    const folderCache = new FolderPathCache();
    folderCache.set("bkt/a", 20);
    folderCache.set("bkt/a/b", 30);
    let listFetchCount = 0;

    const ctx = {
      folderCache,
      listCache: {
        getOrFetch: async () => {
          listFetchCount += 1;
          return [];
        },
        invalidate: () => {},
      },
      drime: {
        listFolder: async () => {
          throw new Error("listFolder should not be called");
        },
        createFolder: async () => {
          throw new Error("createFolder should not be called");
        },
      },
    } as unknown as AppContext;

    const result = await ensureParentFolderForPut(
      ctx,
      1,
      10,
      "bkt",
      "a/b/file.bin",
    );

    expect(result).toEqual({ ok: true, parentId: 30 });
    expect(listFetchCount).toBe(0);
  });

  test("lists existing segments and creates missing segments when cache is cold", async () => {
    const folderCache = new FolderPathCache();
    let listFetchCount = 0;
    let createCount = 0;
    const listings = new Map<number, FileEntry[]>([
      [10, [folderEntry(20, "a", 10)]],
      [20, []],
    ]);

    const ctx = {
      folderCache,
      listCache: {
        getOrFetch: async (
          _parentId: number,
          fetcher: () => Promise<FileEntry[]>,
        ) => {
          listFetchCount += 1;
          return fetcher();
        },
        invalidate: () => {},
      },
      drime: {
        listFolder: async (parentId: number) => listings.get(parentId) ?? [],
        createFolder: async (name: string) => {
          createCount += 1;
          return { folder: { id: name === "b" ? 30 : 0 } };
        },
      },
    } as unknown as AppContext;

    const result = await ensureParentFolderForPut(
      ctx,
      1,
      10,
      "bkt",
      "a/b/file.bin",
    );

    expect(result).toEqual({ ok: true, parentId: 30 });
    expect(listFetchCount).toBe(2);
    expect(createCount).toBe(1);
    expect(folderCache.get("bkt/a")).toBe(20);
    expect(folderCache.get("bkt/a/b")).toBe(30);
  });
});
