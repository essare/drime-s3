const IP_LIKE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** S3 DNS-style bucket name rules (design spec §5.3). */
export function isValidBucketName(name: string): boolean {
  if (name.length < 3 || name.length > 63) return false;
  if (name !== name.toLowerCase()) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  if (!/^[a-z0-9]/.test(name)) return false;
  if (!/[a-z0-9]$/.test(name)) return false;
  if (IP_LIKE.test(name)) return false;
  if (name.startsWith("xn--")) return false;
  if (name.endsWith("-s3alias")) return false;
  if (name.endsWith("--ol-s3")) return false;
  return true;
}

/** Normalize object key: strip leading slashes, collapse duplicate slashes. */
export function normalizeS3Key(key: string): string {
  return key.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}
