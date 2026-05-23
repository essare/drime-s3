import { Buffer } from "node:buffer";
import type { FileEntry } from "../../drime/types";
import type { AppContext } from "../../server-context";
import { etagFromFileEntry } from "../tagging";
import { type ListBucketEntry, listBucketResultXml } from "../xml";

export type AdminObject = {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
};

export type AdminFolder = {
  prefix: string;
  lastModified: string;
};

export type AdminListing = {
  prefix: string;
  delimiter: string;
  objects: AdminObject[];
  folders: AdminFolder[];
  commonPrefixes: string[];
  isTruncated: boolean;
  nextToken: string | null;
  // For XML-side reuse:
  keyCount: number;
  maxKeys: number;
  continuationToken: string | null;
  rawBucket: string;
};

const NOT_FOUND = Symbol("not-found");

type ListCursor = {
  v: 1;
  o: number;
  b: string;
  p: string;
  d: string;
};

function encodeToken(c: ListCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeToken(raw: string | null): ListCursor | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    const pad = s.length % 4;
    const padded = pad ? s + "=".repeat(4 - pad) : s;
    const j = JSON.parse(
      Buffer.from(padded, "base64url").toString("utf8"),
    ) as ListCursor;
    if (
      j?.v === 1 &&
      typeof j.o === "number" &&
      typeof j.b === "string" &&
      typeof j.p === "string" &&
      typeof j.d === "string"
    ) {
      return j;
    }
  } catch {
    // ignore
  }
  return null;
}

function formatIso(updatedAt: string | null): string {
  if (!updatedAt) return new Date(0).toISOString();
  const t = Date.parse(updatedAt);
  return Number.isFinite(t)
    ? new Date(t).toISOString()
    : new Date(0).toISOString();
}

function toContent(entry: FileEntry, key: string): ListBucketEntry {
  return {
    Key: key,
    LastModified: formatIso(entry.updated_at),
    ETag: etagFromFileEntry(entry),
    Size: entry.file_size,
    StorageClass: "STANDARD",
  };
}

/**
 * Resolve `relativePath` (no slashes at ends) as folder segments under `startFolderId`.
 * Folder segments are matched case-insensitively (Python `_find_folder_id`).
 */
async function resolveFolderUnder(
  ctx: AppContext,
  W: number,
  startFolderId: number,
  relativePath: string,
): Promise<number | typeof NOT_FOUND> {
  const trimmed = relativePath.replace(/^\/+|\/+$/g, "");
  if (trimmed.length === 0) {
    return startFolderId;
  }
  const parts = trimmed.split("/").filter(Boolean);
  let currentId = startFolderId;
  for (const part of parts) {
    const entries = await ctx.listCache.getOrFetch(currentId, () =>
      ctx.drime.listFolder(currentId, W),
    );
    const found = entries.find(
      (e) => e.is_folder && e.name.toLowerCase() === part.toLowerCase(),
    );
    if (!found) {
      return NOT_FOUND;
    }
    currentId = found.id;
  }
  return currentId;
}

async function listRecursive(
  ctx: AppContext,
  W: number,
  folderId: number,
  basePrefix: string,
): Promise<ListBucketEntry[]> {
  const entries = await ctx.listCache.getOrFetch(folderId, () =>
    ctx.drime.listFolder(folderId, W),
  );
  const out: ListBucketEntry[] = [];
  for (const entry of entries) {
    const fullKey = basePrefix + entry.name;
    if (entry.is_folder) {
      out.push(...(await listRecursive(ctx, W, entry.id, `${fullKey}/`)));
    } else {
      out.push(toContent(entry, fullKey));
    }
  }
  return out;
}

async function listWithDelimiter(
  ctx: AppContext,
  W: number,
  folderId: number,
  basePrefix: string,
): Promise<{ contents: ListBucketEntry[]; folders: AdminFolder[] }> {
  const entries = await ctx.listCache.getOrFetch(folderId, () =>
    ctx.drime.listFolder(folderId, W),
  );
  const contents: ListBucketEntry[] = [];
  const folders: AdminFolder[] = [];
  for (const entry of entries) {
    const fullKey = basePrefix ? `${basePrefix}${entry.name}` : entry.name;
    if (entry.is_folder) {
      folders.push({
        prefix: `${fullKey}/`,
        lastModified: formatIso(entry.updated_at),
      });
    } else {
      contents.push(toContent(entry, fullKey));
    }
  }
  return { contents, folders };
}

type Row =
  | { kind: "c"; sortKey: string; content: ListBucketEntry }
  | { kind: "p"; sortKey: string; prefix: string; lastModified: string };

function mergeRows(contents: ListBucketEntry[], folders: AdminFolder[]): Row[] {
  const rows: Row[] = [
    ...contents.map((c) => ({
      kind: "c" as const,
      sortKey: c.Key,
      content: c,
    })),
    ...folders.map((f) => ({
      kind: "p" as const,
      sortKey: f.prefix,
      prefix: f.prefix,
      lastModified: f.lastModified,
    })),
  ];
  rows.sort((a, b) =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0,
  );
  return rows;
}

export async function listObjectsCore(
  ctx: AppContext,
  input: {
    bucket: string;
    url: URL;
    workspaceId: number;
    bucketFolderId: number;
  },
): Promise<AdminListing> {
  const { bucket, url, workspaceId: W, bucketFolderId } = input;
  const sp = url.searchParams;
  const prefix = sp.get("prefix") ?? "";
  const delimiter = sp.get("delimiter") ?? "";
  const tokenIn = sp.get("continuation-token");

  const maxKeysRaw = sp.get("max-keys") ?? sp.get("maxkeys");
  let maxKeys = 1000;
  if (maxKeysRaw !== null && maxKeysRaw !== "") {
    const n = Number.parseInt(maxKeysRaw, 10);
    if (Number.isFinite(n)) {
      maxKeys = Math.min(1000, Math.max(1, n));
    }
  }

  const folderPath = prefix.replace(/\/+$/, "");
  let folderId = bucketFolderId;
  let basePrefix = "";

  if (folderPath.length > 0) {
    const resolved = await resolveFolderUnder(
      ctx,
      W,
      bucketFolderId,
      folderPath,
    );
    if (resolved === NOT_FOUND) {
      return {
        prefix,
        delimiter,
        objects: [],
        folders: [],
        commonPrefixes: [],
        isTruncated: false,
        nextToken: null,
        continuationToken: tokenIn ?? null,
        keyCount: 0,
        maxKeys,
        rawBucket: bucket,
      };
    }
    folderId = resolved;
    basePrefix = `${folderPath}/`;
  }

  let contents: ListBucketEntry[] = [];
  let folders: AdminFolder[] = [];

  if (delimiter.length > 0) {
    const r = await listWithDelimiter(ctx, W, folderId, basePrefix);
    contents = r.contents;
    folders = r.folders;
  } else {
    contents = await listRecursive(ctx, W, folderId, basePrefix);
  }

  const rows = mergeRows(contents, folders);
  let start = 0;
  const decoded = decodeToken(tokenIn);
  const dNorm = delimiter;
  if (
    decoded &&
    decoded.b === bucket &&
    decoded.p === prefix &&
    decoded.d === dNorm
  ) {
    start = Math.max(0, Math.min(decoded.o, rows.length));
  }

  const page = rows.slice(start, start + maxKeys);
  const truncated = start + page.length < rows.length;
  const nextOffset = start + page.length;

  const outContents: ListBucketEntry[] = [];
  const outFolders: AdminFolder[] = [];
  for (const row of page) {
    if (row.kind === "c") {
      outContents.push(row.content);
    } else {
      outFolders.push({
        prefix: row.prefix,
        lastModified: row.lastModified,
      });
    }
  }

  const nextTokenEnc = truncated
    ? encodeToken({
        v: 1,
        o: nextOffset,
        b: bucket,
        p: prefix,
        d: dNorm,
      })
    : undefined;

  const objects: AdminObject[] = outContents.map((c) => ({
    key: c.Key,
    size: c.Size,
    lastModified: c.LastModified,
    etag: c.ETag,
  }));

  return {
    prefix,
    delimiter,
    objects,
    folders: outFolders,
    commonPrefixes: outFolders.map((f) => f.prefix),
    isTruncated: truncated,
    nextToken: nextTokenEnc ?? null,
    continuationToken: tokenIn ?? null,
    keyCount: page.length,
    maxKeys,
    rawBucket: bucket,
  };
}

export async function handleListObjects(
  ctx: AppContext,
  input: {
    bucket: string;
    url: URL;
    workspaceId: number;
    bucketFolderId: number;
  },
): Promise<Response> {
  const r = await listObjectsCore(ctx, input);
  const isV2 = input.url.searchParams.get("list-type") === "2";

  const contents: ListBucketEntry[] = r.objects.map((o) => ({
    Key: o.key,
    LastModified: o.lastModified,
    ETag: o.etag,
    Size: o.size,
    StorageClass: "STANDARD",
  }));

  const xml = listBucketResultXml({
    name: r.rawBucket,
    prefix: r.prefix,
    keyCount: r.keyCount,
    maxKeys: r.maxKeys,
    isTruncated: r.isTruncated,
    contents,
    commonPrefixes: r.commonPrefixes.map((Prefix) => ({ Prefix })),
    ...(isV2
      ? {
          continuationToken: r.continuationToken ?? undefined,
          nextContinuationToken: r.nextToken ?? undefined,
        }
      : {}),
  });

  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
}
