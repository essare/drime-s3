import { XMLParser } from "fast-xml-parser";
import { normalizePathKey } from "../../cache/folder-paths";
import type { AppContext } from "../../server-context";
import { s3ErrorXml } from "../errors";
import { isValidBucketName } from "../naming";
import { deleteResultXml } from "../xml";
import { findRootFolder } from "./bucket";
import { resolveObjectKey } from "./object-resolve";

const parser = new XMLParser({
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

function collectKeysFromDeleteDoc(doc: unknown): string[] {
  if (!doc || typeof doc !== "object") return [];
  const root = doc as Record<string, unknown>;
  const del = (root.Delete ?? root.delete) as
    | Record<string, unknown>
    | undefined;
  if (!del) return [];
  const obj = del.Object ?? del.object;
  if (obj === undefined) return [];
  const arr = Array.isArray(obj) ? obj : [obj];
  const keys: string[] = [];
  for (const item of arr) {
    if (item && typeof item === "object") {
      const k =
        (item as Record<string, unknown>).Key ??
        (item as Record<string, unknown>).key;
      if (typeof k === "string" && k.length > 0) keys.push(k);
    }
  }
  return keys;
}

/**
 * S3 `POST /bucket?delete` — batch delete objects.
 */
export async function handleDeleteObjects(
  ctx: AppContext,
  input: {
    bucket: string;
    bodyText: string;
    workspaceId: number;
  },
): Promise<Response> {
  const { bucket, bodyText, workspaceId: W } = input;

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

  let doc: unknown;
  try {
    doc = parser.parse(bodyText);
  } catch {
    return xmlErr(
      400,
      "MalformedXML",
      "The XML you provided was not well-formed.",
    );
  }

  const keys = collectKeysFromDeleteDoc(doc);
  if (keys.length === 0) {
    return new Response(deleteResultXml([], []), {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }

  const deleted: { Key: string }[] = [];
  const errors: { Key: string; Code: string; Message: string }[] = [];
  const parentIdsToInvalidate = new Set<number>();

  const toDelete: { key: string; id: number; parentId: number }[] = [];

  await Promise.all(
    keys.map(async (objectKey) => {
      const r = await resolveObjectKey(
        ctx,
        W,
        bucketFolder.id,
        bucket,
        objectKey,
      );
      if (r.kind === "missing_prefix" || r.kind === "missing_file") {
        deleted.push({ Key: objectKey });
        return;
      }
      toDelete.push({
        key: objectKey,
        id: r.entry.id,
        parentId: r.parentFolderId,
      });
    }),
  );

  if (toDelete.length > 0) {
    try {
      await ctx.drime.deleteEntriesForever(toDelete.map((t) => t.id));
      for (const t of toDelete) {
        deleted.push({ Key: t.key });
        parentIdsToInvalidate.add(t.parentId);
      }
      for (const pid of parentIdsToInvalidate) {
        ctx.listCache.invalidate(pid);
      }
      ctx.folderCache.evictPrefix(normalizePathKey(bucket));
    } catch {
      for (const k of keys) {
        errors.push({
          Key: k,
          Code: "InternalError",
          Message: "Delete failed.",
        });
      }
      return new Response(deleteResultXml([], errors), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    }
  }

  return new Response(deleteResultXml(deleted, errors), {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
}
