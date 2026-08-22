import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { AppContext } from "../server-context";

const DEFAULT_MULTIPART_PUT_THRESHOLD_BYTES = 90 * 1024 * 1024;
const DEFAULT_MULTIPART_PART_SIZE_BYTES = 16 * 1024 * 1024;

/**
 * Threshold (bytes) above which gateway-internal PUT uploads switch from
 * Drime's `/uploads` endpoint (single multipart-form POST, behind a
 * Cloudflare 100 MiB request-size cap) to Drime's S3 multipart protocol
 * (presigned per-part PUTs to storage, no body-size cap).
 * Read dynamically (env var `DRIME_S3_MULTIPART_THRESHOLD_BYTES`) so tests
 * can override at runtime.
 */
export function getMultipartPutThresholdBytes(): number {
  return parsePositiveInt(
    process.env.DRIME_S3_MULTIPART_THRESHOLD_BYTES,
    DEFAULT_MULTIPART_PUT_THRESHOLD_BYTES,
  );
}

/** Default part size for internal multipart uploads. Min 5 MiB (S3 spec). */
export function getMultipartPartSizeBytes(): number {
  return parsePositiveInt(
    process.env.DRIME_S3_MULTIPART_PART_SIZE_BYTES,
    DEFAULT_MULTIPART_PART_SIZE_BYTES,
  );
}

/** S3 limit on number of parts per upload. */
const MAX_PARTS = 10_000;

const DEFAULT_PART_CONCURRENCY = 12;

export function getMultipartPartConcurrency(): number {
  return parsePositiveInt(
    process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY,
    DEFAULT_PART_CONCURRENCY,
  );
}

/** Batch size when calling `s3/multipart/batch-sign-part-urls`. */
const SIGN_BATCH_SIZE = 100;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type MultipartUploadOptions = {
  /** Local path to the spooled file body. */
  tmpPath: string;
  /** Total byte length of `tmpPath`. */
  totalSize: number;
  /** Final filename (basename) used for `clientName`/`relativePath`. */
  filename: string;
  /** S3-style key relative to the bucket (used for Drime relativePath). */
  relativePath: string;
  /** Lower-case extension without leading dot, or empty string. */
  extension: string;
  /** Drime parent folder id where the file should land. */
  parentId: number;
  /** Drime workspace id (`W`). */
  workspaceId: number;
  /** Override constants in tests. */
  partSize?: number;
};

export type MultipartUploadResult = {
  /** Quoted composite multipart-style ETag (md5-of-md5s + "-" + partCount). */
  etag: string;
  /** Final byte length stored. */
  size: number;
  /** Drime fileEntry id, when discoverable from `s3CreateEntry` response. */
  fileEntryId?: number;
};

/**
 * Stream a temp file to Drime via the S3 multipart protocol (init → sign →
 * upload-part × N → complete → s3/entries). Aborts the multipart upload if
 * any step fails.
 */
export async function uploadFileViaInternalMultipart(
  ctx: AppContext,
  opts: MultipartUploadOptions,
): Promise<MultipartUploadResult> {
  if (opts.totalSize <= 0) {
    throw new Error("Cannot multipart upload empty file.");
  }

  const partSize = Math.max(1024, opts.partSize ?? getMultipartPartSizeBytes());
  const partCount = Math.ceil(opts.totalSize / partSize);
  if (partCount > MAX_PARTS) {
    throw new Error(
      `File too large for multipart upload (${partCount} parts > ${MAX_PARTS}).`,
    );
  }

  const { uploadId, key: drimeKey } = await ctx.drime.s3MultipartCreate({
    filename: opts.filename,
    mime: "application/octet-stream",
    size: opts.totalSize,
    extension: opts.extension,
    relativePath: opts.relativePath,
    workspaceId: opts.workspaceId,
    parentId: opts.parentId,
  });

  let entryRaw: unknown;
  const partEtags = new Array<string>(partCount);
  const fh = await open(opts.tmpPath, "r");
  try {
    const signed = await batchSignAllParts(ctx, drimeKey, uploadId, partCount);

    let cursor = 1;
    const lanes = Math.min(getMultipartPartConcurrency(), partCount);
    await Promise.all(
      Array.from({ length: lanes }, async () => {
        while (true) {
          const pn = cursor++;
          if (pn > partCount) return;
          const url = signed.get(pn);
          if (!url) {
            throw new Error(`Missing signed URL for part ${pn}.`);
          }
          const start = (pn - 1) * partSize;
          const length = Math.min(partSize, opts.totalSize - start);
          const buf = Buffer.alloc(length);
          await fh.read(buf, 0, length, start);

          const upstream = await ctx.drime.putUnsignedUrl(url, {
            body: buf,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(length),
            },
          });
          if (!upstream.ok) {
            const txt = await upstream.text().catch(() => "");
            throw new Error(
              `Part ${pn} upload failed (${upstream.status}): ${txt.slice(0, 200)}`,
            );
          }
          const etagHdr = upstream.headers.get("etag") ?? "";
          partEtags[pn - 1] = etagHdr.replace(/^"+|"+$/g, "");
        }
      }),
    );

    await ctx.drime.s3MultipartComplete({
      key: drimeKey,
      uploadId,
      parts: partEtags.map((etag, i) => {
        const drimeEtag = `"${etag}"`;
        return {
          PartNumber: i + 1,
          part_number: i + 1,
          ETag: drimeEtag,
          etag: drimeEtag,
        };
      }),
    });

    entryRaw = await ctx.drime.s3CreateEntry({
      clientMime: "application/octet-stream",
      clientName: opts.filename,
      filename: drimeKey.includes("/")
        ? (drimeKey.split("/").pop() ?? drimeKey)
        : drimeKey,
      clientExtension: opts.extension,
      relativePath: opts.relativePath,
      workspaceId: opts.workspaceId,
      size: opts.totalSize,
      parentId: opts.parentId,
    });
  } catch (e) {
    await ctx.drime
      .s3MultipartAbort({ key: drimeKey, uploadId })
      .catch(() => {});
    throw e;
  } finally {
    await fh.close().catch(() => {});
  }

  return {
    etag: compositeMultipartEtag(partEtags),
    size: opts.totalSize,
    fileEntryId: parseFileEntryId(entryRaw),
  };
}

async function batchSignAllParts(
  ctx: AppContext,
  drimeKey: string,
  uploadId: string,
  partCount: number,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (let start = 1; start <= partCount; start += SIGN_BATCH_SIZE) {
    const end = Math.min(start + SIGN_BATCH_SIZE - 1, partCount);
    const partNumbers: number[] = [];
    for (let i = start; i <= end; i++) partNumbers.push(i);
    const signed = await ctx.drime.s3BatchSignPartUrls({
      key: drimeKey,
      uploadId,
      partNumbers,
    });
    for (const s of signed) out.set(s.partNumber, s.url);
  }
  if (out.size !== partCount) {
    throw new Error(
      `Drime returned ${out.size} signed URLs for ${partCount} parts.`,
    );
  }
  return out;
}

/**
 * Composite multipart ETag using S3's "MD5-of-MD5s + '-' + partCount" format.
 * Each input is an opaque per-part ETag returned by Drime's storage backend
 * (typically a 32-char MD5 hex string). Non-hex ETags fall back to MD5(text).
 */
function compositeMultipartEtag(partEtagsHex: string[]): string {
  const digests: Buffer[] = [];
  for (const raw of partEtagsHex) {
    const hex = raw.replace(/^"+|"+$/g, "");
    if (/^[a-f0-9]{32}$/i.test(hex)) {
      digests.push(Buffer.from(hex, "hex"));
    } else {
      digests.push(createHash("md5").update(hex, "utf8").digest());
    }
  }
  const combined = Buffer.concat(digests);
  const md5 = createHash("md5").update(combined).digest("hex");
  return `"${md5}-${partEtagsHex.length}"`;
}

function parseFileEntryId(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const fe = o.fileEntry ?? o.file ?? o.entry;
  if (!fe || typeof fe !== "object") return undefined;
  const id = (fe as Record<string, unknown>).id;
  return typeof id === "number" && Number.isFinite(id) ? id : undefined;
}
