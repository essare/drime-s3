import { XMLBuilder } from "fast-xml-parser";

const S3_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";

const listBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: false,
  suppressEmptyNode: true,
});

function withDecl(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${inner}`;
}

function xmlnsAttrs() {
  return { "@_xmlns": S3_XMLNS };
}

export type ListBucketEntry = {
  Key: string;
  LastModified: string;
  ETag: string;
  Size: number;
  StorageClass: string;
};

export type ListBucketCommonPrefix = { Prefix: string };

/** GET / — ListAllMyBuckets */
export function listAllMyBucketsXml(opts: {
  ownerId: string;
  ownerDisplayName: string;
  buckets: { name: string; creationDate: string }[];
}): string {
  const buckets =
    opts.buckets.length === 0
      ? undefined
      : {
          Bucket: opts.buckets.map((b) => ({
            Name: b.name,
            CreationDate: b.creationDate,
          })),
        };

  const obj = {
    ListAllMyBucketsResult: {
      ...xmlnsAttrs(),
      Owner: {
        ID: opts.ownerId,
        DisplayName: opts.ownerDisplayName,
      },
      ...(buckets ? { Buckets: buckets } : { Buckets: {} }),
    },
  };

  return withDecl(listBuilder.build(obj));
}

/** ListBucketResult (V1 and V2 share root name; V2 adds optional fields). */
export function listBucketResultXml(opts: {
  name: string;
  prefix: string;
  keyCount: number;
  maxKeys: number;
  isTruncated: boolean;
  contents?: ListBucketEntry[];
  commonPrefixes?: ListBucketCommonPrefix[];
  /** ListObjectsV2 */
  continuationToken?: string;
  nextContinuationToken?: string;
}): string {
  const contents =
    opts.contents && opts.contents.length > 0
      ? {
          Contents: opts.contents.map((c) => ({
            Key: c.Key,
            LastModified: c.LastModified,
            ETag: c.ETag,
            Size: c.Size,
            StorageClass: c.StorageClass,
          })),
        }
      : {};

  const prefixes =
    opts.commonPrefixes && opts.commonPrefixes.length > 0
      ? {
          CommonPrefixes: opts.commonPrefixes.map((p) => ({
            Prefix: p.Prefix,
          })),
        }
      : {};

  const v2extra: Record<string, string> = {};
  if (opts.continuationToken !== undefined) {
    v2extra.ContinuationToken = opts.continuationToken;
  }
  if (opts.nextContinuationToken !== undefined) {
    v2extra.NextContinuationToken = opts.nextContinuationToken;
  }

  const obj = {
    ListBucketResult: {
      ...xmlnsAttrs(),
      Name: opts.name,
      Prefix: opts.prefix,
      KeyCount: opts.keyCount,
      MaxKeys: opts.maxKeys,
      IsTruncated: opts.isTruncated ? "true" : "false",
      ...v2extra,
      ...contents,
      ...prefixes,
    },
  };

  return withDecl(listBuilder.build(obj));
}

export function deleteResultXml(
  deleted: { Key: string }[],
  errors: { Key: string; Code: string; Message: string }[],
): string {
  const obj: Record<string, unknown> = {
    DeleteResult: {
      ...xmlnsAttrs(),
    },
  };
  const root = obj.DeleteResult as Record<string, unknown>;
  if (deleted.length > 0) {
    root.Deleted = deleted.map((d) => ({ Key: d.Key }));
  }
  if (errors.length > 0) {
    root.Error = errors.map((e) => ({
      Key: e.Key,
      Code: e.Code,
      Message: e.Message,
    }));
  }
  return withDecl(listBuilder.build(obj));
}

export function initiateMultipartUploadXml(opts: {
  bucket: string;
  key: string;
  uploadId: string;
}): string {
  const obj = {
    InitiateMultipartUploadResult: {
      ...xmlnsAttrs(),
      Bucket: opts.bucket,
      Key: opts.key,
      UploadId: opts.uploadId,
    },
  };
  return withDecl(listBuilder.build(obj));
}

export function completeMultipartUploadXml(opts: {
  location: string;
  bucket: string;
  key: string;
  etag: string;
}): string {
  const obj = {
    CompleteMultipartUploadResult: {
      ...xmlnsAttrs(),
      Location: opts.location,
      Bucket: opts.bucket,
      Key: opts.key,
      ETag: opts.etag,
    },
  };
  return withDecl(listBuilder.build(obj));
}

export function copyObjectResultXml(opts: {
  etag: string;
  lastModified: string;
}): string {
  const obj = {
    CopyObjectResult: {
      ...xmlnsAttrs(),
      ETag: opts.etag,
      LastModified: opts.lastModified,
    },
  };
  return withDecl(listBuilder.build(obj));
}
