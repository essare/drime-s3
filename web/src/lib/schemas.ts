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
  }),
  drime: z.object({
    reachable: z.boolean(),
    latencyMs: z.number().optional(),
    error: z.string().optional(),
  }),
  workspace: z.object({
    name: z.string(),
    id: z.number().optional(),
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
  commonPrefixes: z.array(z.string()),
  nextToken: z.string().nullable(),
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
