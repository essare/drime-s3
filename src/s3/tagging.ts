import { createHash } from "node:crypto";
import { XMLBuilder } from "fast-xml-parser";
import type { FileEntry } from "../drime/types";

const S3_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";

const tagBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: false,
  suppressEmptyNode: true,
});

function xmlnsAttrs() {
  return { "@_xmlns": S3_XMLNS };
}

const TAG_LINE_PREFIX = "s3tag:";

/** First line may be `md5:…`; optional second line `s3tag:…` (URL-encoded pairs `k=v&…`). */
export function buildObjectDescription(
  md5Hex: string,
  taggingHeader: string | null | undefined,
): string {
  const md5Line = `md5:${md5Hex}`;
  const t = taggingHeader?.trim();
  if (!t) return md5Line;
  return `${md5Line}\n${TAG_LINE_PREFIX}${t}`;
}

/**
 * S3 `ETag` for a `FileEntry` (GET/HEAD/list). Many clients expect a 32-char
 * hex MD5 or a composite multipart form; never emit a non-hex placeholder like
 * `"unknown"` which breaks strict parsers (e.g. Duplicati / .NET). Drime may
 * expose an opaque `hash` (e.g. base64); only use it when it is 32-char hex.
 */
export function etagFromFileEntry(entry: FileEntry): string {
  const first = entry.description?.split("\n")[0]?.trim() ?? "";
  if (first.startsWith("md5:")) {
    const rest = first.slice(4).replace(/\s+/g, "");
    const lower = rest.toLowerCase();
    if (/^[a-f0-9]{32}$/.test(lower)) return `"${lower}"`;
    /** Multipart-style composite ETag persisted by internal uploads: `hex-partCount`. */
    if (/^[a-f0-9]{32}-\d+$/.test(lower)) return `"${lower}"`;
  }
  const rawHash = entry.hash?.trim().replace(/^"+|"+$/g, "") ?? "";
  if (rawHash.length > 0 && /^[a-f0-9]{32}$/i.test(rawHash)) {
    return `"${rawHash.toLowerCase()}"`;
  }
  const fp = createHash("md5")
    .update(
      `${entry.id}\0${entry.file_size}\0${entry.updated_at ?? ""}\0${entry.name}`,
      "utf8",
    )
    .digest("hex");
  return `"${fp}"`;
}

/**
 * Whether {@link etagFromFileEntry} reflects stored object MD5/composite metadata
 * (not the synthetic fingerprint). If false, GET may still derive ETag from bytes
 * for small objects so clients can verify Content-MD5 vs ETag.
 */
export function entryHasStrongContentEtag(entry: FileEntry): boolean {
  const first = entry.description?.split("\n")[0]?.trim() ?? "";
  if (first.startsWith("md5:")) {
    const rest = first.slice(4).replace(/\s+/g, "");
    const lower = rest.toLowerCase();
    if (/^[a-f0-9]{32}$/.test(lower)) return true;
    if (/^[a-f0-9]{32}-\d+$/.test(lower)) return true;
    return false;
  }
  const rawHash = entry.hash?.trim().replace(/^"+|"+$/g, "") ?? "";
  return rawHash.length > 0 && /^[a-f0-9]{32}$/i.test(rawHash);
}

export function parseTaggingLine(description: string | null): string | null {
  if (!description) return null;
  for (const line of description.split("\n")) {
    const t = line.trim();
    if (t.startsWith(TAG_LINE_PREFIX)) {
      return t.slice(TAG_LINE_PREFIX.length);
    }
  }
  return null;
}

/** S3 `GET ?tagging` response. */
export function objectTaggingXml(tagQuery: string | null): string {
  const pairs = new URLSearchParams(tagQuery ?? "");
  const tags: { Key: string; Value: string }[] = [];
  for (const [k, v] of pairs) {
    if (k) tags.push({ Key: k, Value: v });
  }
  const obj = {
    Tagging: {
      ...xmlnsAttrs(),
      TagSet: tags.length === 0 ? {} : { Tag: tags },
    },
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${tagBuilder.build(obj)}`;
}
