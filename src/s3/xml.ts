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

/** GET ?uploadId — ListParts (minimal fields for backup clients). */
export function listPartsResultXml(opts: {
  bucket: string;
  key: string;
  uploadId: string;
  maxParts: number;
  isTruncated: boolean;
  nextPartNumberMarker?: string;
  parts: {
    partNumber: number;
    lastModified: string;
    etag: string;
    size: number;
  }[];
}): string {
  const partNodes =
    opts.parts.length === 0
      ? {}
      : {
          Part: opts.parts.map((p) => ({
            PartNumber: p.partNumber,
            LastModified: p.lastModified,
            ETag: p.etag,
            Size: p.size,
          })),
        };
  const root: Record<string, unknown> = {
    ListPartsResult: {
      ...xmlnsAttrs(),
      Bucket: opts.bucket,
      Key: opts.key,
      UploadId: opts.uploadId,
      MaxParts: opts.maxParts,
      IsTruncated: opts.isTruncated ? "true" : "false",
      ...partNodes,
    },
  };
  if (opts.nextPartNumberMarker !== undefined) {
    (root.ListPartsResult as Record<string, unknown>).NextPartNumberMarker =
      opts.nextPartNumberMarker;
  }
  return withDecl(listBuilder.build(root));
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

/** GET ?location — GetBucketLocation */
export function bucketLocationXml(region: string): string {
  const obj = {
    LocationConstraint: {
      ...xmlnsAttrs(),
      "#text": region,
    },
  };
  return withDecl(listBuilder.build(obj));
}

/** GET ?versioning — minimal stub (suspended). */
export function bucketVersioningXml(): string {
  const obj = {
    VersioningConfiguration: {
      ...xmlnsAttrs(),
      Status: "Suspended",
    },
  };
  return withDecl(listBuilder.build(obj));
}

/** GET ?acl — minimal stub AccessControlPolicy. */
export function bucketAclStubXml(): string {
  const obj = {
    AccessControlPolicy: {
      ...xmlnsAttrs(),
      Owner: {
        ID: "drime",
        DisplayName: "drime",
      },
      AccessControlList: {
        Grant: {
          Grantee: {
            "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "@_xsi:type": "Group",
            URI: "http://acs.amazonaws.com/groups/global/AllUsers",
          },
          Permission: "READ",
        },
      },
    },
  };
  return withDecl(listBuilder.build(obj));
}
