import { normalizePathKey } from "../../cache/folder-paths";
import type { FileEntry } from "../../drime/types";
import type { AppContext } from "../../server-context";
import { s3ErrorXml } from "../errors";

export type KeyResolve =
  | { kind: "file"; entry: FileEntry; parentFolderId: number }
  | { kind: "folder"; entry: FileEntry; parentFolderId: number }
  | {
      kind: "ambiguous";
      entries: FileEntry[];
      parentFolderId: number;
      leafName: string;
    }
  | { kind: "missing_prefix"; leafName: string }
  | { kind: "missing_file"; parentFolderId: number; leafName: string };

export type MutationTarget =
  | { kind: "missing" }
  | { kind: "unique"; entry: FileEntry; parentFolderId: number }
  | {
      kind: "ambiguous";
      parentFolderId: number;
      leafName: string;
      entryIds: number[];
    };

export function readableObjectEntry(
  resolved: KeyResolve,
): { entry: FileEntry; parentFolderId: number } | undefined {
  if (resolved.kind === "file" || resolved.kind === "folder") {
    return { entry: resolved.entry, parentFolderId: resolved.parentFolderId };
  }
  if (resolved.kind === "ambiguous") {
    const entry = resolved.entries[0];
    if (!entry) return undefined;
    return { entry, parentFolderId: resolved.parentFolderId };
  }
  return undefined;
}

export function mutationTargetFromResolved(
  resolved: KeyResolve,
): MutationTarget {
  if (resolved.kind === "ambiguous") {
    return {
      kind: "ambiguous",
      parentFolderId: resolved.parentFolderId,
      leafName: resolved.leafName,
      entryIds: resolved.entries.map((entry) => entry.id),
    };
  }
  if (resolved.kind === "file" || resolved.kind === "folder") {
    return {
      kind: "unique",
      entry: resolved.entry,
      parentFolderId: resolved.parentFolderId,
    };
  }
  return { kind: "missing" };
}

export function logAmbiguousObjectKey(
  ctx: AppContext,
  bucket: string,
  key: string,
  resolved: Extract<KeyResolve, { kind: "ambiguous" }>,
): void {
  ctx.logger.error(
    {
      bucket,
      key,
      parentFolderId: resolved.parentFolderId,
      entryIds: resolved.entries.map((entry) => entry.id),
    },
    "ambiguous_object_key",
  );
}

export function ambiguousMutationError(
  ctx: AppContext,
  bucket: string,
  key: string,
  resolved: Extract<KeyResolve, { kind: "ambiguous" }>,
): Response {
  logAmbiguousObjectKey(ctx, bucket, key, resolved);
  return new Response(s3ErrorXml("InternalError", "Object key is ambiguous."), {
    status: 500,
    headers: { "Content-Type": "application/xml" },
  });
}

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
  const matches = entries.filter((e) => e.name === leafName);
  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      entries: matches,
      parentFolderId,
      leafName,
    };
  }
  const found = matches[0];
  if (!found) {
    return { kind: "missing_file", parentFolderId, leafName };
  }
  if (found.is_folder) {
    return { kind: "folder", entry: found, parentFolderId };
  }
  return { kind: "file", entry: found, parentFolderId };
}
