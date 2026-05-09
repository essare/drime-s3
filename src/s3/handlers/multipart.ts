import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { normalizePathKey } from "../../cache/folder-paths";
import { DrimeApiError } from "../../drime/client";
import {
  type CompositeUploadPayload,
  decodeCompositeUploadId,
  encodeCompositeUploadId,
  InvalidUploadIdError,
} from "../../multipart/session-store";
import type { AppContext } from "../../server-context";
import { s3ErrorXml } from "../errors";
import { isValidBucketName } from "../naming";
import {
  completeMultipartUploadXml,
  initiateMultipartUploadXml,
  listPartsResultXml,
} from "../xml";
import { findRootFolder } from "./bucket";
import { ensureParentFolderForPut } from "./object";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

function xmlErr(status: number, code: string, message: string): Response {
  return new Response(s3ErrorXml(code, message), {
    status,
    headers: { "Content-Type": "application/xml" },
  });
}

function readOptionalMultipartDeclaredSize(req: Request): number {
  for (const h of ["x-amz-meta-size", "x-file-size"]) {
    const v = req.headers.get(h);
    if (v) {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return 0;
}

function parseCompleteMultipartXml(
  text: string,
): { partNumber: number; etag: string }[] {
  let doc: unknown;
  try {
    doc = xmlParser.parse(text);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object") return [];
  const root = doc as Record<string, unknown>;
  const cup = root.CompleteMultipartUpload ?? root.completemultipartupload;
  if (!cup || typeof cup !== "object") return [];
  const c = cup as Record<string, unknown>;
  const partNode = c.Part ?? c.part;
  if (partNode === undefined) return [];
  const arr = Array.isArray(partNode) ? partNode : [partNode];
  const out: { partNumber: number; etag: string }[] = [];
  for (const p of arr) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const pnRaw = o.PartNumber ?? o.partNumber;
    const etRaw = o.ETag ?? o.etag;
    const pn =
      typeof pnRaw === "number"
        ? pnRaw
        : typeof pnRaw === "string"
          ? Number.parseInt(pnRaw, 10)
          : NaN;
    const etagRaw = typeof etRaw === "string" ? etRaw : "";
    const etag = etagRaw.replace(/^"+|"+$/g, "");
    if (Number.isFinite(pn) && etag.length > 0) {
      out.push({ partNumber: pn, etag });
    }
  }
  return out;
}

function compositeMultipartEtag(partEtagsOrdered: string[]): string {
  const digests: Buffer[] = [];
  for (const raw of partEtagsOrdered) {
    const hex = raw.replace(/^"+|"+$/g, "");
    if (/^[a-f0-9]{32}$/i.test(hex)) {
      digests.push(Buffer.from(hex, "hex"));
    } else {
      digests.push(createHash("md5").update(hex, "utf8").digest());
    }
  }
  const combined = Buffer.concat(digests);
  const md5 = createHash("md5").update(combined).digest("hex");
  return `"${md5}-${partEtagsOrdered.length}"`;
}

function assertSessionMatchesDecoded(
  session: {
    drimeUid: string;
    drimeKey: string;
  },
  decoded: CompositeUploadPayload,
): boolean {
  return session.drimeUid === decoded.uid && session.drimeKey === decoded.key;
}

/** Normalize part ETag for Drime complete (strip quotes / weak prefix; lowercase 32-hex). */
function normalizePartEtagForDrime(raw: string): string {
  let t = raw.trim().replace(/^"+|"+$/g, "");
  if (t.startsWith("W/")) {
    t = t
      .slice(2)
      .trim()
      .replace(/^"+|"+$/g, "");
  }
  if (/^[a-f0-9]{32}$/i.test(t)) {
    return t.toLowerCase();
  }
  return t;
}

/**
 * S3 multipart upload (Initiate, Upload Part, Complete, Abort, ListParts) backed by Drime `/s3/multipart/*` + `/s3/entries`.
 */
export async function handleMultipartRequest(
  ctx: AppContext,
  input: {
    method: string;
    bucket: string;
    key: string;
    url: URL;
    req: Request;
    workspaceId: number;
  },
): Promise<Response> {
  const { method, bucket, key, url, req, workspaceId: W } = input;
  const sp = url.searchParams;

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

  if (method === "POST" && sp.has("uploads")) {
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

    const trimmed = key.replace(/^\/+|\/+$/g, "");
    const filename = trimmed.includes("/")
      ? trimmed.slice(trimmed.lastIndexOf("/") + 1)
      : trimmed;
    const extension = filename.includes(".")
      ? filename.slice(filename.lastIndexOf(".") + 1)
      : "";
    const parentId = ensured.parentId;
    const size = readOptionalMultipartDeclaredSize(req);

    const initPayload: Record<string, unknown> = {
      filename,
      mime: "application/octet-stream",
      size,
      extension,
      relativePath: filename,
      workspaceId: W,
    };
    if (parentId !== bucketRootId) {
      initPayload.parentId = parentId;
    }

    try {
      const { uploadId: drimeUid, key: drimeKey } =
        await ctx.drime.s3MultipartCreate(initPayload);
      const compositeId = encodeCompositeUploadId(drimeUid, drimeKey);
      ctx.multipartStore.set(compositeId, {
        key,
        bucket,
        drimeUid,
        drimeKey,
        parentId,
        parts: [],
        createdAt: Date.now(),
      });
      const xml = initiateMultipartUploadXml({
        bucket,
        key,
        uploadId: compositeId,
      });
      return new Response(xml, {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    } catch (e) {
      ctx.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        "multipart init failed",
      );
      return xmlErr(
        500,
        "InternalError",
        e instanceof Error ? e.message : "Multipart init failed.",
      );
    }
  }

  const uploadIdParam = sp.get("uploadId");
  if (!uploadIdParam?.trim()) {
    return xmlErr(400, "InvalidArgument", "Missing uploadId.");
  }

  let decoded: CompositeUploadPayload;
  try {
    decoded = decodeCompositeUploadId(uploadIdParam);
  } catch (e) {
    if (e instanceof InvalidUploadIdError) {
      return xmlErr(400, "InvalidArgument", "Invalid uploadId.");
    }
    throw e;
  }

  if (method === "PUT") {
    const partNum = Number.parseInt(sp.get("partNumber") ?? "", 10);
    if (!Number.isFinite(partNum) || partNum < 1) {
      return xmlErr(400, "InvalidArgument", "Missing or invalid partNumber.");
    }

    const session = ctx.multipartStore.get(uploadIdParam);
    if (!session) {
      return xmlErr(
        404,
        "NoSuchUpload",
        "The specified multipart upload does not exist.",
      );
    }
    if (!assertSessionMatchesDecoded(session, decoded)) {
      return xmlErr(
        404,
        "NoSuchUpload",
        "The specified multipart upload does not exist.",
      );
    }

    const cl = req.headers.get("content-length");
    const clNum = cl ? Number.parseInt(cl, 10) : NaN;
    if (!Number.isFinite(clNum) || clNum < 0) {
      return xmlErr(
        411,
        "MissingContentLength",
        "You must provide the Content-Length HTTP header.",
      );
    }

    const signUrls = await ctx.drime.s3BatchSignPartUrls({
      key: session.drimeKey,
      uploadId: session.drimeUid,
      partNumbers: [partNum],
    });
    const signed =
      signUrls.find((u) => u.partNumber === partNum)?.url ?? signUrls[0]?.url;
    if (!signed) {
      return xmlErr(
        500,
        "InternalError",
        "No signed URL returned for part upload.",
      );
    }

    const rawBody = req.body;
    if (!rawBody && clNum > 0) {
      return xmlErr(400, "InvalidRequest", "Missing request body.");
    }

    try {
      const upstream = await ctx.drime.putUnsignedUrl(signed, {
        body: rawBody ?? new Uint8Array(0),
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(clNum),
        },
      });
      if (!upstream.ok) {
        const t = await upstream.text();
        return xmlErr(
          500,
          "InternalError",
          `Part upload failed (${upstream.status}): ${t.slice(0, 200)}`,
        );
      }
      const etagHdr = upstream.headers.get("etag");
      const etag = etagHdr
        ? etagHdr.replace(/^"+|"+$/g, "")
        : createHash("md5").update("").digest("hex");

      const idx = session.parts.findIndex((p) => p.partNumber === partNum);
      const record = {
        partNumber: partNum,
        size: clNum,
        md5: etag,
        etag,
      };
      if (idx >= 0) {
        session.parts[idx] = record;
      } else {
        session.parts.push(record);
      }

      return new Response("", {
        status: 200,
        headers: { ETag: `"${etag}"` },
      });
    } catch (e) {
      ctx.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        "multipart upload part failed",
      );
      return xmlErr(
        500,
        "InternalError",
        e instanceof Error ? e.message : "Part upload failed.",
      );
    }
  }

  if (method === "POST") {
    const session = ctx.multipartStore.get(uploadIdParam);
    if (!session) {
      return xmlErr(
        404,
        "NoSuchUpload",
        "The specified multipart upload does not exist.",
      );
    }
    if (!assertSessionMatchesDecoded(session, decoded)) {
      return xmlErr(
        404,
        "NoSuchUpload",
        "The specified multipart upload does not exist.",
      );
    }

    const bodyText = await req.text();
    const xmlParts = parseCompleteMultipartXml(bodyText);
    if (xmlParts.length === 0) {
      return xmlErr(
        400,
        "MalformedXML",
        "The XML you provided was not well-formed or did not validate against our published schema.",
      );
    }

    const byPart = new Map(session.parts.map((p) => [p.partNumber, p]));
    const sortedParts = [...xmlParts].sort(
      (a, b) => a.partNumber - b.partNumber,
    );
    const completePayload = {
      key: session.drimeKey,
      uploadId: session.drimeUid,
      parts: sortedParts.map((xp) => {
        const rec = byPart.get(xp.partNumber);
        const etagRaw = rec?.etag ?? xp.etag;
        const hex = normalizePartEtagForDrime(etagRaw);
        /** Drime validates ETag as a quoted S3-style string (see API error: must be quoted string). */
        const drimeEtag = `"${hex}"`;
        return {
          PartNumber: xp.partNumber,
          part_number: xp.partNumber,
          ETag: drimeEtag,
          etag: drimeEtag,
        };
      }),
    };

    try {
      await ctx.drime.s3MultipartComplete(completePayload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.logger.error({ err: msg }, "multipart complete failed");
      if (e instanceof DrimeApiError) {
        const safe = msg.replace(/</g, " ").slice(0, 2000);
        if (e.status >= 400 && e.status < 500) {
          return xmlErr(400, "InvalidRequest", safe);
        }
      }
      return xmlErr(
        500,
        "InternalError",
        e instanceof Error ? msg.slice(0, 2000) : "Multipart complete failed.",
      );
    }

    const trimmed = session.key.replace(/^\/+|\/+$/g, "");
    const filename = trimmed.includes("/")
      ? trimmed.slice(trimmed.lastIndexOf("/") + 1)
      : trimmed;
    const extension = filename.includes(".")
      ? filename.slice(filename.lastIndexOf(".") + 1)
      : "";
    let finalSize = 0;
    for (const p of xmlParts) {
      const rec = byPart.get(p.partNumber);
      if (rec) finalSize += rec.size;
    }
    if (finalSize === 0 && session.parts.length > 0) {
      finalSize = session.parts.reduce((a, p) => a + p.size, 0);
    }

    const entryPayload: Record<string, unknown> = {
      clientMime: "application/octet-stream",
      clientName: filename,
      filename: session.drimeKey.includes("/")
        ? (session.drimeKey.split("/").pop() ?? session.drimeKey)
        : session.drimeKey,
      clientExtension: extension,
      relativePath: filename,
      workspaceId: W,
      size: finalSize,
      parentId: session.parentId,
    };

    try {
      await ctx.drime.s3CreateEntry(entryPayload);
    } catch (e) {
      ctx.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        "s3/entries after multipart failed",
      );
      return xmlErr(
        500,
        "InternalError",
        e instanceof Error ? e.message : "Create entry failed.",
      );
    }

    ctx.multipartStore.delete(uploadIdParam);
    ctx.listCache.invalidate(session.parentId);
    ctx.folderCache.evictPrefix(normalizePathKey(`${bucket}/${session.key}`));

    const etagsOrdered = sortedParts.map((xp) => {
      const rec = byPart.get(xp.partNumber);
      return rec?.etag ?? xp.etag;
    });
    const etagOut =
      etagsOrdered.length > 0
        ? compositeMultipartEtag(etagsOrdered)
        : '"complete"';

    const xml = completeMultipartUploadXml({
      location: `${url.origin}/${bucket}/${session.key
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/")}`,
      bucket,
      key: session.key,
      etag: etagOut,
    });
    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }

  if (method === "DELETE") {
    try {
      await ctx.drime.s3MultipartAbort({
        key: decoded.key,
        uploadId: decoded.uid,
      });
    } catch {
      /* best-effort */
    }
    ctx.multipartStore.delete(uploadIdParam);
    return new Response(null, { status: 204 });
  }

  if (method === "GET") {
    const session = ctx.multipartStore.get(uploadIdParam);
    if (!session) {
      return xmlErr(
        404,
        "NoSuchUpload",
        "The specified multipart upload does not exist.",
      );
    }
    if (!assertSessionMatchesDecoded(session, decoded)) {
      return xmlErr(
        404,
        "NoSuchUpload",
        "The specified multipart upload does not exist.",
      );
    }

    const partMarkerRaw = sp.get("part-number-marker");
    const markerNum = partMarkerRaw ? Number.parseInt(partMarkerRaw, 10) : NaN;
    let ordered = [...session.parts].sort(
      (a, b) => a.partNumber - b.partNumber,
    );
    if (Number.isFinite(markerNum)) {
      ordered = ordered.filter((p) => p.partNumber > markerNum);
    }
    const maxPartsRaw = sp.get("max-parts");
    const maxParts = Math.min(
      1000,
      Math.max(1, Number.parseInt(maxPartsRaw ?? "1000", 10) || 1000),
    );
    const sliced = ordered.slice(0, maxParts);
    const isTruncated = ordered.length > sliced.length;
    const lastPart = sliced[sliced.length - 1];
    const nextPartNumberMarker =
      isTruncated && lastPart !== undefined
        ? String(lastPart.partNumber)
        : undefined;

    const iso = new Date(session.createdAt).toISOString();
    const lastModified = iso.replace(/\.\d{3}Z$/, ".000Z");

    const xml = listPartsResultXml({
      bucket,
      key: session.key,
      uploadId: uploadIdParam,
      maxParts,
      isTruncated,
      nextPartNumberMarker,
      parts: sliced.map((p) => ({
        partNumber: p.partNumber,
        lastModified,
        etag: p.etag.includes('"') ? p.etag : `"${p.etag}"`,
        size: p.size,
      })),
    });
    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }

  return xmlErr(
    405,
    "MethodNotAllowed",
    "The specified method is not allowed against this resource.",
  );
}
