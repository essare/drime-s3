import { z } from "zod";

export const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  hasPassword: z.boolean(),
});

export const SessionSchema = z.object({
  authenticated: z.boolean(),
  expiresAt: z.string().nullable(),
});

export const LoginResponseSchema = z.object({
  authenticated: z.literal(true),
  expiresInSec: z.number(),
});

export const StatusSchema = z.object({
  env: z.object({
    drimeApiKeySet: z.boolean(),
    drimeApiBaseUrl: z.string(),
    s3KeysSet: z.boolean(),
    region: z.string(),
    webUiPasswordSet: z.boolean(),
  }),
  drime: z.object({
    reachable: z.boolean(),
    latencyMs: z.number().optional(),
    error: z.string().optional(),
  }),
  workspace: z.object({
    name: z.string(),
    id: z.number().nullable(),
    exists: z.boolean(),
  }),
});

export const InitResponseSchema = z.object({ workspaceId: z.number() });

export const BucketsResponseSchema = z.object({
  buckets: z.array(
    z.object({
      name: z.string(),
      createdAt: z.string(),
    }),
  ),
  count: z.number(),
});

export const BucketCreatedSchema = z.object({ name: z.string() });

export const CreateFolderResponseSchema = z.object({
  name: z.string(),
  prefix: z.string(),
});
export type CreateFolderResponse = z.infer<typeof CreateFolderResponseSchema>;

export const StatsResponseSchema = z.object({
  buckets: z.number(),
  totalBytes: z.number(),
  totalObjects: z.number(),
  perBucket: z.array(
    z.object({
      name: z.string(),
      bytes: z.number(),
      objects: z.number(),
    }),
  ),
});

const ListingFolderSchema = z.object({
  prefix: z.string(),
  lastModified: z.string(),
});

export const ListingSchema = z.object({
  prefix: z.string(),
  delimiter: z.string(),
  objects: z.array(
    z.object({
      key: z.string(),
      size: z.number(),
      lastModified: z.string(),
      etag: z.string(),
    }),
  ),
  folders: z.array(ListingFolderSchema).optional().default([]),
  commonPrefixes: z.array(z.string()),
  nextToken: z.string().nullable(),
});

export const FolderStatsResponseSchema = z.object({
  stats: z.array(
    z.object({
      prefix: z.string(),
      size: z.number(),
      objectCount: z.number(),
      lastModified: z.string().nullable().optional(),
    }),
  ),
});

export const PutObjectResponseSchema = z.object({
  etag: z.string(),
  size: z.number(),
});

export const BatchDeleteResponseSchema = z.object({
  deleted: z.array(z.string()),
  errors: z.array(
    z.object({
      key: z.string(),
      code: z.string(),
      message: z.string(),
    }),
  ),
});

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type StatusData = z.infer<typeof StatusSchema>;
export type StatsData = z.infer<typeof StatsResponseSchema>;
