import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChunkedPayloadError,
  createAwsChunkedPayloadTransform,
} from "../../auth/chunked-decoder";
import { normalizePathKey } from "../../cache/folder-paths";
import {
  getMultipartPutThresholdBytes,
  uploadFileViaInternalMultipart,
} from "../../drime/multipart-upload";
import type { FileEntry } from "../../drime/types";
import type { AppContext } from "../../server-context";
import { s3ErrorXml } from "../errors";
import { isValidBucketName } from "../naming";
import {
  buildObjectDescription,
  etagFromEntryDescription,
  objectTaggingXml,
  parseTaggingLine,
} from "../tagging";
import { copyObjectResultXml } from "../xml";
import { findRootFolder, parseCreateFolderResponse } from "./bucket";
import { resolveObjectKey } from "./object-resolve";

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
  const fromDesc = etagFromEntryDescription(entry.description);
  if (fromDesc !== '"unknown"') return fromDesc;
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

export async function ensureParentFolderForPut(
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
): Promise<{
  tmpDir: string;
  tmpPath: string;
  md5Hex: string;
  totalSize: number;
}> {
  const hash = createHash("md5");
  const tmpDir = await mkdtemp(join(tmpdir(), "drime-s3-put-"));
  const tmpPath = join(tmpDir, "body.bin");
  const rawBody = req.body;
  if (!rawBody) {
    const fh = await open(tmpPath, "w", 0o600);
    await fh.close();
    return { tmpDir, tmpPath, md5Hex: hash.digest("hex"), totalSize: 0 };
  }
  const isAwsChunked =
    req.headers.get("x-amz-content-sha256") ===
    "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";
  const stream = isAwsChunked
    ? rawBody.pipeThrough(
        createAwsChunkedPayloadTransform({ insecure: ctx.config.insecure }),
      )
    : rawBody;

  let totalSize = 0;
  const reader = stream.getReader();
  const fh = await open(tmpPath, "w", 0o600);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined && value.byteLength > 0) {
        hash.update(value);
        await fh.write(value);
        totalSize += value.byteLength;
      }
    }
  } finally {
    await fh.close();
    reader.releaseLock();
  }
  return { tmpDir, tmpPath, md5Hex: hash.digest("hex"), totalSize };
}

function parseCopySourceHeader(
  raw: string | null,
): { bucket: string; key: string } | null {
  if (raw === null || raw.trim() === "") return null;
  const decoded = decodeURIComponent(raw.trim());
  const stripped = decoded.replace(/^\/+/, "");
  const slash = stripped.indexOf("/");
  if (slash < 0) return null;
  return {
    bucket: stripped.slice(0, slash),
    key: stripped.slice(slash + 1),
  };
}

function formatCopyLastModified(entry: FileEntry): string {
  const t = entry.updated_at ? Date.parse(entry.updated_at) : NaN;
  const d = Number.isFinite(t) ? new Date(t) : new Date();
  return d.toISOString().replace(/\.\d+Z$/, ".000Z");
}

async function handlePutCopyObject(
  ctx: AppContext,
  W: number,
  destBucket: string,
  destKey: string,
  destBucketRootId: number,
  req: Request,
  destResolved: Awaited<ReturnType<typeof resolveObjectKey>>,
): Promise<Response> {
  const parsed = parseCopySourceHeader(req.headers.get("x-amz-copy-source"));
  if (!parsed || !isValidBucketName(parsed.bucket)) {
    return xmlErr(400, "InvalidArgument", "Invalid x-amz-copy-source.");
  }

  const srcBucketFolder = await findRootFolder(ctx, W, parsed.bucket);
  if (srcBucketFolder === undefined) {
    return xmlErr(
      404,
      "NoSuchBucket",
      "The specified copy source bucket does not exist.",
    );
  }

  const srcResolved = await resolveObjectKey(
    ctx,
    W,
    srcBucketFolder.id,
    parsed.bucket,
    parsed.key,
  );
  if (srcResolved.kind !== "file") {
    return xmlErr(404, "NoSuchKey", "The specified key does not exist.");
  }
  const srcEntry = srcResolved.entry;
  const downloadUrl = resolveDownloadUrl(srcEntry, ctx);
  const upstream = await ctx.drime.fetchAuthenticated(downloadUrl, {
    method: "GET",
  });
  if (!upstream.ok) {
    return xmlErr(500, "CopyFailed", "Could not read copy source.");
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  const md5Hex = createHash("md5").update(buf).digest("hex");

  const ensured = await ensureParentFolderForPut(
    ctx,
    W,
    destBucketRootId,
    destBucket,
    destKey,
  );
  if (!ensured.ok) {
    return ensured.response;
  }
  const parentId = ensured.parentId;

  const trimmed = destKey.replace(/^\/+|\/+$/g, "");
  const basename = trimmed.includes("/")
    ? trimmed.slice(trimmed.lastIndexOf("/") + 1)
    : trimmed;
  const relativePath = parentId === destBucketRootId ? trimmed : basename;

  let tmpDir = "";
  try {
    tmpDir = await mkdtemp(join(tmpdir(), "drime-s3-copy-"));
    const tmpPath = join(tmpDir, "src.bin");
    await writeFile(tmpPath, buf);

    if (destResolved.kind === "file" || destResolved.kind === "folder") {
      await ctx.drime.deleteEntriesForever([destResolved.entry.id]);
      ctx.listCache.invalidate(destResolved.parentFolderId);
    }

    const uploadRaw = await ctx.drime.uploadFile({
      filePath: tmpPath,
      relativePath,
      parentId,
      workspaceId: W,
    });
    const uploadedId = parseUploadFileEntryId(uploadRaw);
    if (uploadedId !== undefined) {
      try {
        await ctx.drime.updateFileEntryDescription(
          uploadedId,
          buildObjectDescription(md5Hex, req.headers.get("x-amz-tagging")),
        );
      } catch {
        /* optional Drime feature */
      }
    }
    ctx.listCache.invalidate(parentId);

    const xml = copyObjectResultXml({
      etag: `"${md5Hex}"`,
      lastModified: formatCopyLastModified(srcEntry),
    });
    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml",
      },
    });
  } catch (e) {
    ctx.logger.error(
      {
        err: e,
        srcBucket: parsed.bucket,
        srcKey: parsed.key,
        destBucket,
        destKey,
      },
      "PUT copy object failed",
    );
    if (ctx.config.insecure && e instanceof Error) {
      return xmlErr(
        500,
        "InternalError",
        `Copy failed: ${e.message.slice(0, 800)}`,
      );
    }
    return xmlErr(500, "InternalError", "Copy failed.");
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
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
 * @returns `null` when multipart query params should be handled in `handlers/multipart.ts`.
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

  if (method === "GET" && url.searchParams.has("tagging")) {
    if (
      resolved.kind === "missing_prefix" ||
      resolved.kind === "missing_file" ||
      resolved.kind === "folder"
    ) {
      return xmlErr(404, "NoSuchKey", "The specified key does not exist.");
    }
    const xml = objectTaggingXml(parseTaggingLine(resolved.entry.description));
    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }

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
      return handlePutCopyObject(
        ctx,
        W,
        bucket,
        key,
        bucketRootId,
        req,
        resolved,
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
    const extension = basename.includes(".")
      ? basename.slice(basename.lastIndexOf(".") + 1).toLowerCase()
      : "";

    let tmpDir = "";
    try {
      const spooled = await writeRequestBodyToTemp(req, ctx);
      tmpDir = spooled.tmpDir;
      const { tmpPath, md5Hex, totalSize } = spooled;

      if (resolved.kind === "file" || resolved.kind === "folder") {
        await ctx.drime.deleteEntriesForever([resolved.entry.id]);
        ctx.listCache.invalidate(resolved.parentFolderId);
      }

      // Drime's `/uploads` endpoint sits behind a Cloudflare 100 MiB
      // request-size cap. For larger bodies, fall back to Drime's S3
      // multipart protocol (presigned per-part PUTs to storage, no cap).
      if (totalSize > getMultipartPutThresholdBytes()) {
        const multipart = await uploadFileViaInternalMultipart(ctx, {
          tmpPath,
          totalSize,
          filename: basename,
          relativePath,
          extension,
          parentId,
          workspaceId: W,
        });
        // Persist the composite ETag so subsequent GET/HEAD/list responses
        // return the same value as the upload response.
        if (multipart.fileEntryId !== undefined) {
          try {
            await ctx.drime.updateFileEntryDescription(
              multipart.fileEntryId,
              buildObjectDescription(
                multipart.etag.replace(/^"|"$/g, ""),
                req.headers.get("x-amz-tagging"),
              ),
            );
          } catch {
            /* optional Drime feature */
          }
        }
        ctx.listCache.invalidate(parentId);
        return new Response("", {
          status: 200,
          headers: {
            ETag: multipart.etag,
            "Content-Length": "0",
          },
        });
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
            buildObjectDescription(md5Hex, req.headers.get("x-amz-tagging")),
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
      ctx.logger.error(
        { err: e, bucket, key, parentId, relativePath },
        "PUT object failed",
      );
      // In insecure (dev) mode, surface the upstream error so the operator can
      // diagnose without grepping logs. Production callers still see the
      // generic message to avoid leaking internals.
      if (ctx.config.insecure && e instanceof Error) {
        const detail = e.message.slice(0, 800);
        return xmlErr(500, "InternalError", `Upload failed: ${detail}`);
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
