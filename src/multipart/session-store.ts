import { Buffer } from "node:buffer";

const PREFIX = "v1.";

export type CompositeUploadPayload = {
  uid: string;
  key: string;
};

export class InvalidUploadIdError extends Error {
  readonly name = "InvalidUploadIdError";
}

/** Encode internal upload id + object key into S3 UploadId (versioned). */
export function encodeCompositeUploadId(uid: string, key: string): string {
  const json = JSON.stringify({ uid, key });
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  return `${PREFIX}${b64}`;
}

/** Decode S3 UploadId to `{ uid, key }`. Accepts legacy Python composites without `v1.` prefix. */
export function decodeCompositeUploadId(
  compositeId: string,
): CompositeUploadPayload {
  let s = compositeId.trim();
  if (s.startsWith(PREFIX)) {
    s = s.slice(PREFIX.length);
  }
  const pad = s.length % 4;
  if (pad) {
    s += "=".repeat(4 - pad);
  }
  try {
    const data = Buffer.from(s, "base64url");
    const decoded = JSON.parse(data.toString("utf8")) as unknown;
    if (
      decoded &&
      typeof decoded === "object" &&
      "uid" in decoded &&
      "key" in decoded &&
      typeof (decoded as { uid: unknown }).uid === "string" &&
      typeof (decoded as { key: unknown }).key === "string"
    ) {
      return {
        uid: (decoded as { uid: string }).uid,
        key: (decoded as { key: string }).key,
      };
    }
  } catch {
    // fall through
  }
  throw new InvalidUploadIdError("Invalid UploadId");
}

export type MultipartSession = {
  key: string;
  parts: Array<{ size: number; md5: string; etag: string }>;
  createdAt: number;
};

export type MultipartSessionStoreOptions = {
  maxSessions?: number;
  ttlMs?: number;
  now?: () => number;
};

/**
 * In-memory multipart upload sessions. Bounded by count; optional TTL on read.
 */
export class MultipartSessionStore {
  private readonly maxSessions: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly map = new Map<string, MultipartSession>();

  constructor(options: MultipartSessionStoreOptions = {}) {
    this.maxSessions = options.maxSessions ?? 10_000;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  set(uploadId: string, session: MultipartSession): void {
    if (!this.map.has(uploadId) && this.map.size >= this.maxSessions) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(uploadId, session);
  }

  get(uploadId: string): MultipartSession | undefined {
    const s = this.map.get(uploadId);
    if (!s) return undefined;
    if (this.now() - s.createdAt > this.ttlMs) {
      this.map.delete(uploadId);
      return undefined;
    }
    return s;
  }

  delete(uploadId: string): void {
    this.map.delete(uploadId);
  }

  /** For health / metrics. */
  get size(): number {
    return this.map.size;
  }
}
