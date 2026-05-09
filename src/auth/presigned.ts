/**
 * Presigned URL (query-string Sig V4) verification — stub until full port (plan §6.2).
 */

import type { VerifySignatureV4Credentials } from "./sigv4";

function paramKeysLower(url: URL): string[] {
  return [...url.searchParams.keys()].map((k) => k.toLowerCase());
}

/** True when the request URL carries AWS Sig V4 query auth parameters. */
export function hasPresignedAuth(url: URL): boolean {
  const lower = new Set(paramKeysLower(url));
  return (
    lower.has("x-amz-algorithm") ||
    lower.has("x-amz-credential") ||
    lower.has("x-amz-signature")
  );
}

export type VerifyPresignedOpts = {
  method: string;
  url: URL;
};

/**
 * @returns whether the presigned URL is valid. Stub always returns `false`.
 */
export async function verifyPresignedUrl(
  _req: Request,
  _opts: VerifyPresignedOpts,
  _credentials: VerifySignatureV4Credentials,
): Promise<boolean> {
  return false;
}
