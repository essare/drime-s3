import { normalizePathKey } from "../cache/folder-paths";
import type { AppContext } from "../server-context";
import { findRootFolder, parseCreateFolderResponse } from "../s3/handlers/bucket";
import { handleObjectRequest } from "../s3/handlers/object";
import { listObjectsCore, type AdminListing } from "../s3/handlers/list-objects";
import { isValidBucketName } from "../s3/naming";

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
  if (id !== undefined) {
    ctx.folderCache.set(normalizePathKey(name), id);
  }
  ctx.listCache.invalidate(null);
  return { kind: "ok" };
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
  ctx.listCache.invalidate(null);
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
  if (q.max) u.searchParams.set("max-keys", String(Math.min(1000, Math.max(1, q.max))));

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
  body: ReadableStream<Uint8Array> | ArrayBuffer | null,
  contentType: string | null,
  contentLength: number | null,
): Promise<PutObjectResult> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) return { kind: "no-such-bucket" };

  const u = new URL(`http://internal/${bucket}/${encodeKeyForUrl(key)}`);
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  if (contentLength !== null) headers.set("content-length", String(contentLength));
  headers.set("x-amz-content-sha256", "UNSIGNED-PAYLOAD");

  const synthReq = new Request(u, { method: "PUT", headers, body });
  const res = await handleObjectRequest(ctx, {
    method: "PUT",
    bucket,
    key,
    url: u,
    req: synthReq,
    workspaceId: W,
  });
  if (res === null) {
    return { kind: "error", status: 500, code: "InternalError", message: "Object handler returned null." };
  }
  if (res.status === 200) {
    const etag = res.headers.get("etag") ?? '"unknown"';
    return { kind: "ok", etag, size: contentLength ?? 0 };
  }
  return await translateS3XmlError(res);
}

function encodeKeyForUrl(key: string): string {
  return key.split("/").map((p) => encodeURIComponent(p)).join("/");
}

async function translateS3XmlError(res: Response): Promise<PutObjectResult> {
  const text = await res.text();
  const codeMatch = /<Code>([^<]+)<\/Code>/.exec(text);
  const msgMatch = /<Message>([^<]*)<\/Message>/.exec(text);
  const code = codeMatch?.[1] ?? "InternalError";
  const message = msgMatch?.[1] ?? "Object operation failed.";
  if (code === "NoSuchBucket") return { kind: "no-such-bucket" };
  if (res.status >= 400 && res.status < 500) return { kind: "invalid", message };
  return { kind: "error", status: res.status, code, message };
}
