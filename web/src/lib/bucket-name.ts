import { z } from "zod";

const IP_LIKE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Mirrors gateway `src/s3/naming.ts` `isValidBucketName` exactly. */
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

/**
 * Client-side bucket name validation with clear messages, plus a final
 * `isValidBucketName` check so behavior stays aligned with the gateway.
 */
export const bucketNameSchema = z
  .string()
  .min(3, "Must be at least 3 characters")
  .max(63, "Must be 63 or fewer characters")
  .refine((n) => n === n.toLowerCase(), "Use lowercase letters only")
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/,
    "Use lowercase letters, digits, and hyphens; must start and end with a letter or digit",
  )
  .refine((n) => !IP_LIKE.test(n), "Must not look like an IP address")
  .refine((n) => !n.startsWith("xn--"), "Must not start with 'xn--'")
  .refine(
    (n) => !n.endsWith("-s3alias") && !n.endsWith("--ol-s3"),
    "Must not end with reserved suffix",
  )
  .refine((n) => isValidBucketName(n), { message: "Invalid bucket name" });
