import { normalizePathKey } from "../cache/folder-paths";
import { drimeTimestampToIso } from "../drime/datetime";
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
      createdAt:
        drimeTimestampToIso(e.updated_at, e.created_at) ??
        new Date(0).toISOString(),
    }));
}

export type { BucketStat, WorkspaceStats } from "./stats-types";

import type { BucketStat, WorkspaceStats } from "./stats-types";

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

export type FolderStatEntry = {
  prefix: string;
  size: number;
  /** Omitted in fast mode (Drime `file_size` only). */
  objectCount: number | null;
  lastModified: string | null;
};

export const FOLDER_STATS_MAX_PREFIXES = 10;

/** Read current `file_size` for a folder row from Drime (bypasses list TTL cache). */
async function drimeFolderFileSize(
  ctx: AppContext,
  W: number,
  entry: FileEntry,
): Promise<number> {
  const parentId = entry.parent_id;
  const siblings =
    parentId === null
      ? await ctx.drime.listFolder(null, W)
      : await ctx.drime.listFolder(parentId, W);
  const fresh = siblings.find((e) => e.id === entry.id);
  return fresh?.file_size ?? entry.file_size;
}

export async function adminFolderStatsBatch(
  ctx: AppContext,
  W: number,
  bucket: string,
  prefixes: readonly string[],
): Promise<
  | { kind: "ok"; stats: FolderStatEntry[] }
  | { kind: "no-such-bucket" }
  | { kind: "invalid"; message: string }
> {
  if (prefixes.length > FOLDER_STATS_MAX_PREFIXES) {
    return {
      kind: "invalid",
      message: `At most ${FOLDER_STATS_MAX_PREFIXES} folder prefixes per request.`,
    };
  }
  const root = await findRootFolder(ctx, W, bucket);
  if (root === undefined) return { kind: "no-such-bucket" };

  const stats = await mapWithConcurrency(prefixes, 3, async (rawPrefix) => {
    const prefix = rawPrefix.endsWith("/") ? rawPrefix : `${rawPrefix}/`;
    const folderPath = prefix.replace(/\/+$/, "");
    const resolved = await resolvePrefixUnder(ctx, W, root.id, folderPath);
    if (resolved === "missing") {
      return { prefix, size: 0, objectCount: 0, lastModified: null };
    }
    const size = await drimeFolderFileSize(ctx, W, resolved.entry);
    return {
      prefix,
      size,
      objectCount: null,
      lastModified: drimeTimestampToIso(
        resolved.entry.updated_at,
        resolved.entry.created_at,
      ),
    };
  });
  return { kind: "ok", stats };
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
 * Workspace stats. Default (`accurate: false`) uses Drime folder `file_size` on
 * the root listing only — O(1) Drime list per workspace. With `accurate: true`,
 * recurses every bucket (slow on high latency or large trees).
 */
export async function adminGetStats(
  ctx: AppContext,
  W: number,
  options?: { accurate?: boolean },
): Promise<WorkspaceStats> {
  const accurate = options?.accurate === true;
  const cached = ctx.statsCache.get(accurate);
  if (cached) return cached;

  let stats: WorkspaceStats;
  if (!accurate) {
    const root = await ctx.drime.listFolder(null, W);
    const bucketFolders = root.filter(
      (e) => e.is_folder && isValidBucketName(e.name),
    );
    const perBucket: BucketStat[] = bucketFolders.map((f) => ({
      name: f.name,
      bytes: f.file_size,
      objects: null,
    }));
    perBucket.sort((a, b) => a.name.localeCompare(b.name));
    let totalBytes = 0;
    for (const b of perBucket) {
      totalBytes += b.bytes;
    }
    stats = {
      buckets: bucketFolders.length,
      totalBytes,
      totalObjects: null,
      perBucket,
      source: "metadata",
    };
  } else {
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
      totalObjects += b.objects ?? 0;
    }
    stats = {
      buckets: bucketFolders.length,
      totalBytes,
      totalObjects,
      perBucket,
      source: "walk",
    };
  }

  ctx.statsCache.set(stats, accurate);
  return stats;
}

export type CreateBucketResult =
  | { kind: "ok" }
  | { kind: "invalid-name" }
  | { kind: "exists" };

export type CreateFolderResult =
  | { kind: "ok"; name: string; prefix: string; id: number }
  | { kind: "no-such-bucket" }
  | { kind: "no-such-prefix" }
  | { kind: "invalid"; message: string }
  | { kind: "exists"; existingKind: "file" | "folder" };

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
    ctx.statsCache.invalidate();
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

export function buildSeedFolderEntry(
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
    created_at: null,
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
  ctx.statsCache.invalidate();
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

const FOLDER_NAME_MAX = 255;
// biome-ignore lint/suspicious/noControlCharactersInRegex: validating folder names per admin contract
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

function validateFolderName(
  raw: string,
): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.trim();
  if (name.length === 0)
    return { ok: false, message: "Folder name is required." };
  if (name.length > FOLDER_NAME_MAX) {
    return {
      ok: false,
      message: `Folder name must be ${FOLDER_NAME_MAX} characters or fewer.`,
    };
  }
  if (/[/\\]/.test(name))
    return { ok: false, message: "Slashes are not allowed." };
  if (CONTROL_CHAR_RE.test(name))
    return { ok: false, message: "Control characters are not allowed." };
  if (name === "." || name === "..")
    return { ok: false, message: "Reserved name." };
  return { ok: true, name };
}

async function resolvePrefixUnder(
  ctx: AppContext,
  W: number,
  bucketRootId: number,
  prefix: string,
): Promise<{ folderId: number; entry: FileEntry } | "missing"> {
  const trimmed = prefix.replace(/^\/+|\/+$/g, "");
  if (trimmed.length === 0) {
    return {
      folderId: bucketRootId,
      entry: {
        id: bucketRootId,
        name: "",
        parent_id: null,
        is_folder: true,
        file_size: 0,
        hash: null,
        mime: null,
        updated_at: null,
        created_at: null,
        description: null,
        url: null,
      },
    };
  }
  const parts = trimmed.split("/").filter(Boolean);
  let currentId = bucketRootId;
  let currentEntry: FileEntry | null = null;
  for (const part of parts) {
    const entries = await ctx.listCache.getOrFetch(currentId, () =>
      ctx.drime.listFolder(currentId, W),
    );
    const found = entries.find(
      (e) => e.is_folder && e.name.toLowerCase() === part.toLowerCase(),
    );
    if (!found) return "missing";
    currentEntry = found;
    currentId = found.id;
  }
  if (!currentEntry) return "missing";
  return { folderId: currentId, entry: currentEntry };
}

export async function adminCreateFolder(
  ctx: AppContext,
  W: number,
  bucket: string,
  prefix: string,
  rawName: string,
): Promise<CreateFolderResult> {
  const validation = validateFolderName(rawName);
  if (!validation.ok) return { kind: "invalid", message: validation.message };
  const { name } = validation;

  const root = await findRootFolder(ctx, W, bucket);
  if (root === undefined) return { kind: "no-such-bucket" };

  const parentResolved = await resolvePrefixUnder(ctx, W, root.id, prefix);
  if (parentResolved === "missing") return { kind: "no-such-prefix" };
  const parentId = parentResolved.folderId;

  const siblings = await ctx.listCache.getOrFetch(parentId, () =>
    ctx.drime.listFolder(parentId, W),
  );
  const collision = siblings.find(
    (e) => e.name.toLowerCase() === name.toLowerCase(),
  );
  if (collision) {
    return {
      kind: "exists",
      existingKind: collision.is_folder ? "folder" : "file",
    };
  }

  const raw = await ctx.drime.createFolder(name, { parentId, workspaceId: W });
  const id = parseCreateFolderResponse(raw);
  if (id === undefined) {
    ctx.listCache.invalidate(parentId);
    const trimmedPrefix = prefix.replace(/^\/+|\/+$/g, "");
    return {
      kind: "ok",
      name,
      prefix: trimmedPrefix ? `${trimmedPrefix}/${name}/` : `${name}/`,
      id: -1,
    };
  }
  ctx.listCache.addEntry(parentId, buildSeedFolderEntry(raw, id, name));
  const trimmedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  return {
    kind: "ok",
    name,
    prefix: trimmedPrefix ? `${trimmedPrefix}/${name}/` : `${name}/`,
    id,
  };
}
