import { normalizePathKey } from "../../cache/folder-paths";
import type { FileEntry } from "../../drime/types";
import type { AppContext } from "../../server-context";

export type KeyResolve =
  | { kind: "file"; entry: FileEntry; parentFolderId: number }
  | { kind: "folder"; entry: FileEntry; parentFolderId: number }
  | { kind: "missing_prefix"; leafName: string }
  | { kind: "missing_file"; parentFolderId: number; leafName: string };

export async function resolveObjectKey(
  ctx: AppContext,
  W: number,
  bucketRootId: number,
  bucket: string,
  key: string,
): Promise<KeyResolve> {
  const trimmed = key.replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return { kind: "missing_file", parentFolderId: bucketRootId, leafName: "" };
  }
  const parts = trimmed.split("/").filter(Boolean);
  const leafName = parts[parts.length - 1] ?? "";
  const parentSegments = parts.slice(0, -1);

  let parentFolderId = bucketRootId;
  let pathAccum = "";

  for (const seg of parentSegments) {
    pathAccum = pathAccum ? `${pathAccum}/${seg}` : seg;
    const cacheKey = normalizePathKey(`${bucket}/${pathAccum}`);
    const cached = ctx.folderCache.get(cacheKey);
    if (cached !== undefined) {
      parentFolderId = cached;
      continue;
    }
    const entries = await ctx.listCache.getOrFetch(parentFolderId, () =>
      ctx.drime.listFolder(parentFolderId, W),
    );
    const found = entries.find(
      (e) => e.is_folder && e.name.toLowerCase() === seg.toLowerCase(),
    );
    if (!found) {
      return { kind: "missing_prefix", leafName };
    }
    parentFolderId = found.id;
    ctx.folderCache.set(cacheKey, found.id);
  }

  if (parentSegments.length > 0) {
    ctx.folderCache.set(
      normalizePathKey(`${bucket}/${parentSegments.join("/")}`),
      parentFolderId,
    );
  }

  const entries = await ctx.listCache.getOrFetch(parentFolderId, () =>
    ctx.drime.listFolder(parentFolderId, W),
  );
  for (const e of entries) {
    if (e.name === leafName) {
      if (e.is_folder) {
        return { kind: "folder", entry: e, parentFolderId };
      }
      return { kind: "file", entry: e, parentFolderId };
    }
  }
  return { kind: "missing_file", parentFolderId, leafName };
}
