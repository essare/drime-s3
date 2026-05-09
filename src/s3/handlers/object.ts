import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChunkedPayloadError,
  createAwsChunkedPayloadTransform,
} from "../../auth/chunked-decoder";
import { normalizePathKey } from "../../cache/folder-paths";
import type { FileEntry } from "../../drime/types";
import type { AppContext } from "../../server-context";
import { s3ErrorXml } from "../errors";
import { isValidBucketName } from "../naming";
import { findRootFolder, parseCreateFolderResponse } from "./bucket";

function xmlErr(status: number, code: string, message: string): Response {
  return new Response(s3ErrorXml(code, message), {
    status,
    headers: { "Content-Type": "application/xml" },
  });
}

function formatHttpDate(updatedAt: string | null): string {
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  const d = Number.isFinite(t) ? new Date(t) : new Date(0);
  return d.toUTCString();
}

function entryEtag(entry: FileEntry): string {
  if (entry.description?.startsWith("md5:")) {
    return `"${entry.description.slice(4)}"`;
  }
  if (entry.hash) {
    return `"${entry.hash}"`;
  }
  return '"unknown"';
}

function joinUrlWithApiBase(apiBaseUrl: string, relativeUrl: string): string {
  if (relativeUrl.startsWith("http")) return relativeUrl;
  const base = apiBaseUrl.replace(/\/api\/v1\/?$/i, "").replace(/\/+$/, "");
  const path = relativeUrl.startsWith("/") ? relativeUrl : `/${relativeUrl}`;
  return `${base}${path}`;
}

function resolveDownloadUrl(entry: FileEntry, ctx: AppContext): string {
  const u = entry.url;
  if (u?.startsWith("http")) return u;
  if (u) return joinUrlWithApiBase(ctx.config.drime.apiBaseUrl, u);
  return ctx.drime.getDownloadUrl(entry.id);
}

type KeyResolve =
  | { kind: "file"; entry: FileEntry; parentFolderId: number }
  | { kind: "folder"; entry: FileEntry; parentFolderId: number }
  | { kind: "missing_prefix"; leafName: string }
  | { kind: "missing_file"; parentFolderId: number; leafName: string };

async function resolveObjectKey(
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

async function ensureParentFolderForPut(
  ctx: AppContext,
  W: number,
  bucketRootId: number,
  bucket: string,
  key: string,
): Promise<{ ok: true; parentId: number } | { ok: false; response: Response }> {
  const trimmed = key.replace(/^\/+|\/+$/g, "");
  const dirname = trimmed.includes("/")
    ? trimmed.slice(0, trimmed.lastIndexOf("/"))
    : "";
  if (!dirname) {
    return { ok: true, parentId: bucketRootId };
  }
  const parts = dirname.split("/").filter(Boolean);
  let currentPid = bucketRootId;
  let pathAccum = "";
  for (const folderName of parts) {
    pathAccum = pathAccum ? `${pathAccum}/${folderName}` : folderName;
    const entries = await ctx.listCache.getOrFetch(currentPid, () =>
      ctx.drime.listFolder(currentPid, W),
    );
    const found = entries.find(
      (e) => e.is_folder && e.name.toLowerCase() === folderName.toLowerCase(),
    );
    if (!found) {
      const raw = await ctx.drime.createFolder(folderName, {
        parentId: currentPid,
        workspaceId: W,
      });
      const newId = parseCreateFolderResponse(raw);
      if (newId === undefined) {
        return {
          ok: false,
          response: xmlErr(
            500,
            "InternalError",
            "Failed to create parent folder.",
          ),
        };
      }
      ctx.listCache.invalidate(currentPid);
      ctx.folderCache.set(normalizePathKey(`${bucket}/${pathAccum}`), newId);
      currentPid = newId;
      continue;
    }
    ctx.folderCache.set(normalizePathKey(`${bucket}/${pathAccum}`), found.id);
    currentPid = found.id;
  }
  return { ok: true, parentId: currentPid };
}

function parseUploadFileEntryId(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const fe = o.fileEntry ?? o.file;
  if (!fe || typeof fe !== "object") return undefined;
  const id = (fe as Record<string, unknown>).id;
  return typeof id === "number" && Number.isFinite(id) ? id : undefined;
}

async function writeRequestBodyToTemp(
  req: Request,
  ctx: AppContext,
): Promise<{ tmpDir: string; tmpPath: string; md5Hex: string }> {
  const hash = createHash("md5");
  const tmpDir = await mkdtemp(join(tmpdir(), "drime-s3-put-"));
  const tmpPath = join(tmpDir, "body.bin");
  const rawBody = req.body;
  if (!rawBody) {
    const fh = await open(tmpPath, "w", 0o600);
    await fh.close();
    return { tmpDir, tmpPath, md5Hex: hash.digest("hex") };
  }
  const isAwsChunked =
    req.headers.get("x-amz-content-sha256") ===
    "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";
  const stream = isAwsChunked
    ? rawBody.pipeThrough(
        createAwsChunkedPayloadTransform({ insecure: ctx.config.insecure }),
      )
    : rawBody;

  const reader = stream.getReader();
  const fh = await open(tmpPath, "w", 0o600);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined && value.byteLength > 0) {
        hash.update(value);
        await fh.write(value);
      }
    }
  } finally {
    await fh.close();
    reader.releaseLock();
  }
  return { tmpDir, tmpPath, md5Hex: hash.digest("hex") };
}

function pickDownloadResponseHeaders(
  upstream: Response,
): Record<string, string> {
  const out: Record<string, string> = {};
  const ct = upstream.headers.get("content-type");
  if (ct) out["Content-Type"] = ct;
  const cl = upstream.headers.get("content-length");
  if (cl) out["Content-Length"] = cl;
  const cr = upstream.headers.get("content-range");
  if (cr) out["Content-Range"] = cr;
  out["Accept-Ranges"] = "bytes";
  return out;
}

/**
 * Single-object S3 routes under `/<bucket>/<key>`.
 * @returns `null` when multipart query params should be handled elsewhere (501 for now).
 */
export async function handleObjectRequest(
  ctx: AppContext,
  input: {
    method: string;
    bucket: string;
    key: string;
    url: URL;
    req: Request;
    workspaceId: number;
  },
): Promise<Response | null> {
  const { method, bucket, key, url, req, workspaceId: W } = input;
  const sp = url.searchParams;
  if (sp.has("uploads") || sp.get("uploadId")) {
    return null;
  }

  if (!isValidBucketName(bucket)) {
    return xmlErr(
      400,
      "InvalidBucketName",
      "The specified bucket is not valid.",
    );
  }

  const bucketFolder = await findRootFolder(ctx, W, bucket);
  if (bucketFolder === undefined) {
    return xmlErr(404, "NoSuchBucket", "The specified bucket does not exist.");
  }
  const bucketRootId = bucketFolder.id;

  const resolved = await resolveObjectKey(ctx, W, bucketRootId, bucket, key);

  if (method === "HEAD") {
    if (
      resolved.kind === "missing_prefix" ||
      resolved.kind === "missing_file" ||
      resolved.kind === "folder"
    ) {
      return xmlErr(404, "NoSuchKey", "The specified key does not exist.");
    }
    const { entry } = resolved;
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": entry.mime ?? "application/octet-stream",
        "Content-Length": String(entry.file_size),
        "Last-Modified": formatHttpDate(entry.updated_at),
        ETag: entryEtag(entry),
        "Accept-Ranges": "bytes",
      },
    });
  }

  if (method === "GET") {
    if (
      resolved.kind === "missing_prefix" ||
      resolved.kind === "missing_file"
    ) {
      return xmlErr(404, "NoSuchKey", "The specified key does not exist.");
    }
    if (resolved.kind === "folder") {
      return xmlErr(
        400,
        "InvalidRequest",
        "Cannot download folder as an object.",
      );
    }
    const { entry } = resolved;
    const downloadUrl = resolveDownloadUrl(entry, ctx);
    const range = req.headers.get("Range");
    const upstream = await ctx.drime.fetchAuthenticated(downloadUrl, {
      method: "GET",
      headers: range ? { Range: range } : undefined,
    });
    if (!upstream.ok && upstream.status !== 206) {
      const t = await upstream.text();
      return xmlErr(
        500,
        "DownloadFailed",
        `Upstream download failed (${upstream.status}): ${t.slice(0, 200)}`,
      );
    }
    const headers = pickDownloadResponseHeaders(upstream);
    headers["Last-Modified"] = formatHttpDate(entry.updated_at);
    headers.ETag = entryEtag(entry);
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  }

  if (method === "DELETE") {
    if (
      resolved.kind === "missing_prefix" ||
      resolved.kind === "missing_file"
    ) {
      return new Response(null, { status: 204 });
    }
    try {
      await ctx.drime.deleteEntriesForever([resolved.entry.id]);
      ctx.listCache.invalidate(resolved.parentFolderId);
      ctx.folderCache.evictPrefix(normalizePathKey(`${bucket}/${key}`));
      return new Response(null, { status: 204 });
    } catch {
      return xmlErr(500, "InternalError", "Delete failed.");
    }
  }

  if (method === "PUT") {
    if (req.headers.get("x-amz-copy-source")) {
      return new Response(
        s3ErrorXml("NotImplemented", "CopyObject is not implemented yet."),
        {
          status: 501,
          headers: { "Content-Type": "application/xml" },
        },
      );
    }

    const ensured = await ensureParentFolderForPut(
      ctx,
      W,
      bucketRootId,
      bucket,
      key,
    );
    if (!ensured.ok) {
      return ensured.response;
    }
    const parentId = ensured.parentId;
    const trimmed = key.replace(/^\/+|\/+$/g, "");
    const basename = trimmed.includes("/")
      ? trimmed.slice(trimmed.lastIndexOf("/") + 1)
      : trimmed;
    const relativePath = parentId === bucketRootId ? trimmed : basename;

    let tmpDir = "";
    try {
      const spooled = await writeRequestBodyToTemp(req, ctx);
      tmpDir = spooled.tmpDir;
      const { tmpPath, md5Hex } = spooled;

      if (resolved.kind === "file" || resolved.kind === "folder") {
        await ctx.drime.deleteEntriesForever([resolved.entry.id]);
        ctx.listCache.invalidate(resolved.parentFolderId);
      }

      const raw = await ctx.drime.uploadFile({
        filePath: tmpPath,
        relativePath,
        parentId,
        workspaceId: W,
      });
      const uploadedId = parseUploadFileEntryId(raw);
      if (uploadedId !== undefined) {
        try {
          await ctx.drime.updateFileEntryDescription(
            uploadedId,
            `md5:${md5Hex}`,
          );
        } catch {
          /* optional Drime feature */
        }
      }
      ctx.listCache.invalidate(parentId);

      return new Response("", {
        status: 200,
        headers: {
          ETag: `"${md5Hex}"`,
          "Content-Length": "0",
        },
      });
    } catch (e) {
      if (e instanceof ChunkedPayloadError) {
        return xmlErr(400, "InvalidRequest", e.message);
      }
      return xmlErr(500, "InternalError", "Upload failed.");
    } finally {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  return new Response(
    s3ErrorXml("NotImplemented", "This operation is not implemented yet."),
    {
      status: 501,
      headers: { "Content-Type": "application/xml" },
    },
  );
}
