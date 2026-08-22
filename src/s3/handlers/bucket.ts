import { normalizePathKey } from "../../cache/folder-paths";
import type { FileEntry } from "../../drime/types";
import type { AppContext } from "../../server-context";
import { s3ErrorXml } from "../errors";
import { isValidBucketName } from "../naming";
import {
  bucketAclStubXml,
  bucketLocationXml,
  bucketVersioningXml,
} from "../xml";
import { handleDeleteObjects } from "./batch";
import { handleListObjects } from "./list-objects";

function xmlErr(status: number, code: string, message: string): Response {
  return new Response(s3ErrorXml(code, message), {
    status,
    headers: { "Content-Type": "application/xml" },
  });
}

export async function findRootFolder(
  ctx: AppContext,
  workspaceId: number,
  bucket: string,
): Promise<FileEntry | undefined> {
  const entries = await ctx.listCache.getOrFetch(null, () =>
    ctx.drime.listFolder(null, workspaceId),
  );
  const lower = bucket.toLowerCase();
  return entries.find((e) => e.is_folder && e.name.toLowerCase() === lower);
}

export function parseCreateFolderResponse(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const folder = o.folder;
  if (!folder || typeof folder !== "object") return undefined;
  const id = (folder as Record<string, unknown>).id;
  return typeof id === "number" && Number.isFinite(id) ? id : undefined;
}

/**
 * Bucket-level routes when the path is exactly `/<bucket>` (no object key).
 * @returns `null` if this handler does not apply (delegate to object / 501).
 */
export async function handleBucketOnly(
  ctx: AppContext,
  input: {
    method: string;
    bucket: string;
    url: URL;
    workspaceId: number;
    req: Request;
  },
): Promise<Response | null> {
  const { method, bucket, url, workspaceId: W, req } = input;

  if (!isValidBucketName(bucket)) {
    return xmlErr(
      400,
      "InvalidBucketName",
      `The specified bucket is not valid.`,
    );
  }

  if (method === "POST" && url.searchParams.has("delete")) {
    const bodyText = await req.text();
    return handleDeleteObjects(ctx, { bucket, bodyText, workspaceId: W });
  }

  if (method === "PUT") {
    return handleCreateBucket(ctx, bucket, W);
  }

  if (method === "DELETE") {
    return handleDeleteBucket(ctx, bucket, W);
  }

  if (method === "HEAD") {
    return handleHeadBucket(ctx, bucket, W);
  }

  if (method === "GET") {
    const sp = url.searchParams;
    if (sp.has("location")) {
      return new Response(bucketLocationXml(ctx.config.s3.region), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    }
    if (sp.has("versioning")) {
      return new Response(bucketVersioningXml(), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    }
    if (sp.has("acl")) {
      return new Response(bucketAclStubXml(), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    }
    const folder = await findRootFolder(ctx, W, bucket);
    if (folder === undefined) {
      return xmlErr(
        404,
        "NoSuchBucket",
        "The specified bucket does not exist.",
      );
    }
    return handleListObjects(ctx, {
      bucket,
      url,
      workspaceId: W,
      bucketFolderId: folder.id,
    });
  }

  return null;
}

async function handleCreateBucket(
  ctx: AppContext,
  bucket: string,
  W: number,
): Promise<Response> {
  const existing = await findRootFolder(ctx, W, bucket);
  if (existing !== undefined) {
    return xmlErr(
      409,
      "BucketAlreadyExists",
      "The requested bucket name is not available.",
    );
  }

  const raw = await ctx.drime.createFolder(bucket, { workspaceId: W });
  const id = parseCreateFolderResponse(raw);
  if (id !== undefined) {
    ctx.folderCache.set(normalizePathKey(bucket), id);
  }
  ctx.listCache.invalidate(null);

  return new Response("", {
    status: 200,
    headers: {
      "Content-Length": "0",
    },
  });
}

async function handleDeleteBucket(
  ctx: AppContext,
  bucket: string,
  W: number,
): Promise<Response> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) {
    return xmlErr(404, "NoSuchBucket", "The specified bucket does not exist.");
  }

  ctx.listCache.invalidate(folder.id);
  const children = (await ctx.drime.listFolder(folder.id, W)).filter(
    (entry) => entry.id !== folder.id,
  );
  if (children.length > 0) {
    return xmlErr(
      409,
      "BucketNotEmpty",
      "The bucket you tried to delete is not empty.",
    );
  }

  try {
    await ctx.drime.deleteEntriesForever([folder.id]);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.trim() : String(error).trim();
    return xmlErr(500, "InternalError", detail || "Bucket deletion failed.");
  }
  ctx.listCache.invalidate(null);
  ctx.listCache.invalidate(folder.id);
  ctx.folderCache.evictPrefix(normalizePathKey(bucket));

  return new Response("", {
    status: 204,
    headers: { "Content-Length": "0" },
  });
}

async function handleHeadBucket(
  ctx: AppContext,
  bucket: string,
  W: number,
): Promise<Response> {
  const folder = await findRootFolder(ctx, W, bucket);
  if (folder === undefined) {
    return xmlErr(404, "NoSuchBucket", "The specified bucket does not exist.");
  }

  return new Response(null, {
    status: 200,
    headers: {
      "x-amz-bucket-region": ctx.config.s3.region,
    },
  });
}
