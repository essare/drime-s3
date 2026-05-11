import { normalizePathKey } from "../cache/folder-paths";
import { type FileEntry, fromFileEntryJson } from "../drime/types";
import {
  findRootFolder,
  parseCreateFolderResponse,
} from "../s3/handlers/bucket";
import {
  type AdminListing,
  listObjectsCore,
} from "../s3/handlers/list-objects";
import { handleObjectRequest } from "../s3/handlers/object";
import { isValidBucketName } from "../s3/naming";
import type { AppContext } from "../server-context";
import { jsonError } from "./errors";

export type BucketSummary = { name: string; createdAt: string };

export async function adminListBuckets(
  ctx: AppContext,
  W: number,
): Promise<BucketSummary[]> {
  const entries = await ctx.listCache.getOrFetch(null, () =>
    ctx.drime.listFolder(null, W),
  );
  return entries
    .filter((e) => e.is_folder && isValidBucketName(e.name))
    .map((e) => ({
      name: e.name,
      createdAt: e.updated_at ?? new Date(0).toISOString(),
    }));
}

export type BucketStat = { name: string; bytes: number; objects: number };

export type WorkspaceStats = {
  buckets: number;
  totalBytes: number;
  totalObjects: number;
  perBucket: BucketStat[];
};

/**
 * Recursively sum file sizes and object counts under `folderId`. Uses
 * `listCache` so concurrent walks coalesce on the same parent and short-TTL
 * repeats are free. Iterative (BFS) to avoid stack growth on deep trees.
 */
async function walkFolderSize(
  ctx: AppContext,
  W: number,
  folderId: number,
): Promise<{ bytes: number; objects: number }> {
  let bytes = 0;
  let objects = 0;
  const queue: number[] = [folderId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    const entries = await ctx.listCache.getOrFetch(id, () =>
      ctx.drime.listFolder(id, W),
    );
    for (const e of entries) {
      if (e.is_folder) {
        queue.push(e.id);
      } else {
        bytes += e.file_size;
        objects += 1;
      }
    }
  }
  return { bytes, objects };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        const item = items[idx];
        if (item === undefined) return;
        out[idx] = await fn(item);
      }
    }),
  );
  return out;
}

/**
 * Compute workspace-wide stats: total bucket count, total bytes, total
 * objects, and per-bucket breakdown. Buckets are walked with bounded
 * concurrency to avoid hammering Drime when the workspace has many buckets.
 */
export async function adminGetStats(
  ctx: AppContext,
  W: number,
): Promise<WorkspaceStats> {
  const root = await ctx.listCache.getOrFetch(null, () =>
    ctx.drime.listFolder(null, W),
  );
  const bucketFolders = root.filter(
    (e) => e.is_folder && isValidBucketName(e.name),
  );
  const perBucket = await mapWithConcurrency(bucketFolders, 4, async (f) => {
    const { bytes, objects } = await walkFolderSize(ctx, W, f.id);
    return { name: f.name, bytes, objects } satisfies BucketStat;
  });
  perBucket.sort((a, b) => a.name.localeCompare(b.name));
  let totalBytes = 0;
  let totalObjects = 0;
  for (const b of perBucket) {
    totalBytes += b.bytes;
    totalObjects += b.objects;
  }
  return {
    buckets: bucketFolders.length,
    totalBytes,
    totalObjects,
    perBucket,
  };
}


export type CreateBucketResult =
  | { kind: "ok" }
  | { kind: "invalid-name" }
  | { kind: "exists" };

export async function adminCreateBucket(
  ctx: AppContext,
  W: number,
  name: string,
): Promise<CreateBucketResult> {
  if (!isValidBucketName(name)) return { kind: "invalid-name" };
  const existing = await findRootFolder(ctx, W, name);
  if (existing !== undefined) return { kind: "exists" };
  const raw = await ctx.drime.createFolder(name, { workspaceId: W });
  const id = parseCreateFolderResponse(raw);
  if (id === undefined) {
    // Couldn't extract the folder id; fall back to invalidate. The dashboard
    // may briefly show "Bucket not found" until upstream propagation, but
    // that's preferable to seeding the wrong id.
    ctx.listCache.invalidate(null);
    return { kind: "ok" };
  }
  ctx.folderCache.set(normalizePathKey(name), id);
  // Drime's folder listing is eventually consistent: a list issued moments
  // after createFolder may not include the new folder. Seed the cached root
  // listing with the freshly created entry so subsequent reads (e.g. the UI
  // navigating to /buckets/<name> right after creation) see it immediately.
  ctx.listCache.addEntry(null, buildSeedFolderEntry(raw, id, name));
  return { kind: "ok" };
}

function buildSeedFolderEntry(
  raw: unknown,
  id: number,
  name: string,
): FileEntry {
  const folder = (raw as { folder?: unknown } | null)?.folder;
  const parsed = fromFileEntryJson(folder ?? null);
  if (parsed.id === id && parsed.name === name && parsed.is_folder) {
    return parsed;
  }
  return {
    id,
    name,
    parent_id: null,
    is_folder: true,
    file_size: 0,
    hash: null,
    mime: null,
    updated_at: new Date().toISOString(),
    description: null,
    url: null,
  };
}

export type DeleteBucketResult =
  | { kind: "ok" }
  | { kind: "missing" }
  | { kind: "not-empty" };

export async function adminDeleteBucket(
  ctx: AppContext,
  W: number,
  name: string,
): Promise<DeleteBucketResult> {
  const folder = await findRootFolder(ctx, W, name);
  if (folder === undefined) return { kind: "missing" };
  const children = await ctx.drime.listFolder(folder.id, W);
  if (children.length > 0) return { kind: "not-empty" };
  await ctx.drime.deleteEntriesForever([folder.id]);
  // Splice the deleted bucket out of the cached root listing instead of
  // invalidating it, so the next list isn't subject to upstream eventual
  // consistency (which can briefly resurrect the deleted bucket).
  ctx.listCache.removeEntryById(null, folder.id);
  ctx.listCache.invalidate(folder.id);
  ctx.folderCache.evictPrefix(normalizePathKey(name));
  return { kind: "ok" };
}

export type ListObjectsQuery = {
  prefix?: string;
  delimiter?: string;
  token?: string;
  max?: number;
};

export type ListObjectsResult =
  | { kind: "ok"; listing: AdminListing }
  | { kind: "no-such-bucket" };

export async function adminListObjects(
  ctx: AppContext,
  W: number,
  bucket: string,
  q: ListObjectsQuery,
): Promise<ListObjectsResult> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) return { kind: "no-such-bucket" };

  const u = new URL(`http://internal/${bucket}`);
  if (q.prefix) u.searchParams.set("prefix", q.prefix);
  if (q.delimiter) u.searchParams.set("delimiter", q.delimiter);
  if (q.token) u.searchParams.set("continuation-token", q.token);
  u.searchParams.set("list-type", "2");
  if (q.max)
    u.searchParams.set("max-keys", String(Math.min(1000, Math.max(1, q.max))));

  const listing = await listObjectsCore(ctx, {
    bucket,
    url: u,
    workspaceId: W,
    bucketFolderId: folder.id,
  });
  return { kind: "ok", listing };
}

export type PutObjectResult =
  | { kind: "ok"; etag: string; size: number }
  | { kind: "no-such-bucket" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; status: number; code: string; message: string };

export async function adminPutObject(
  ctx: AppContext,
  W: number,
  bucket: string,
  key: string,
  req: Request,
): Promise<PutObjectResult> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) return { kind: "no-such-bucket" };

  const u = new URL(`http://internal/${bucket}/${encodeKeyForUrl(key)}`);
  const res = await handleObjectRequest(ctx, {
    method: "PUT",
    bucket,
    key,
    url: u,
    req,
    workspaceId: W,
  });
  if (res === null) {
    return {
      kind: "error",
      status: 500,
      code: "InternalError",
      message: "Object handler returned null.",
    };
  }
  if (res.status === 200) {
    const etag = res.headers.get("etag") ?? '"unknown"';
    const cl = req.headers.get("content-length");
    const len = cl === null ? null : Number.parseInt(cl, 10);
    return {
      kind: "ok",
      etag,
      size: len !== null && Number.isFinite(len) ? len : 0,
    };
  }
  return await translateS3XmlError(res);
}

function encodeKeyForUrl(key: string): string {
  return key
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
}

async function translateS3XmlError(res: Response): Promise<PutObjectResult> {
  const text = await res.text();
  const codeMatch = /<Code>([^<]+)<\/Code>/.exec(text);
  const msgMatch = /<Message>([^<]*)<\/Message>/.exec(text);
  const code = codeMatch?.[1] ?? "InternalError";
  const message = msgMatch?.[1] ?? "Object operation failed.";
  if (code === "NoSuchBucket") return { kind: "no-such-bucket" };
  if (res.status >= 400 && res.status < 500)
    return { kind: "invalid", message };
  return { kind: "error", status: res.status, code, message };
}

export async function adminGetObject(
  ctx: AppContext,
  W: number,
  bucket: string,
  key: string,
  range: string | null,
): Promise<Response> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) {
    return jsonError(
      "NoSuchBucket",
      "The specified bucket does not exist.",
      404,
    );
  }

  const u = new URL(`http://internal/${bucket}/${encodeKeyForUrl(key)}`);
  const headers = new Headers();
  if (range) headers.set("range", range);

  const synthReq = new Request(u, { method: "GET", headers });
  const res = await handleObjectRequest(ctx, {
    method: "GET",
    bucket,
    key,
    url: u,
    req: synthReq,
    workspaceId: W,
  });
  if (res === null) {
    return jsonError("InternalError", "Object handler returned null.", 500);
  }
  if (res.status === 200 || res.status === 206) {
    const out = new Headers();
    for (const k of [
      "content-type",
      "content-length",
      "content-range",
      "etag",
      "last-modified",
      "accept-ranges",
    ]) {
      const v = res.headers.get(k);
      if (v) out.set(k, v);
    }
    out.set("Cache-Control", "no-store");
    return new Response(res.body, { status: res.status, headers: out });
  }
  const text = await res.text();
  const codeMatch = /<Code>([^<]+)<\/Code>/.exec(text);
  const msgMatch = /<Message>([^<]*)<\/Message>/.exec(text);
  return jsonError(
    codeMatch?.[1] ?? "InternalError",
    msgMatch?.[1] ?? "Download failed.",
    res.status,
  );
}

export async function adminDeleteObject(
  ctx: AppContext,
  W: number,
  bucket: string,
  key: string,
): Promise<
  | { kind: "ok" }
  | { kind: "no-such-bucket" }
  | { kind: "error"; status: number; code: string; message: string }
> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) return { kind: "no-such-bucket" };

  const u = new URL(`http://internal/${bucket}/${encodeKeyForUrl(key)}`);
  const synthReq = new Request(u, { method: "DELETE", headers: new Headers() });
  const res = await handleObjectRequest(ctx, {
    method: "DELETE",
    bucket,
    key,
    url: u,
    req: synthReq,
    workspaceId: W,
  });
  if (res === null) {
    return {
      kind: "error",
      status: 500,
      code: "InternalError",
      message: "Object handler returned null.",
    };
  }
  if (res.status === 204) return { kind: "ok" };
  const text = await res.text();
  const codeMatch = /<Code>([^<]+)<\/Code>/.exec(text);
  const msgMatch = /<Message>([^<]*)<\/Message>/.exec(text);
  return {
    kind: "error",
    status: res.status,
    code: codeMatch?.[1] ?? "InternalError",
    message: msgMatch?.[1] ?? "Delete failed.",
  };
}
