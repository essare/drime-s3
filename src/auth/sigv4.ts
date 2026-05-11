/**
 * AWS Signature Version 4 verification (header-based).
 * Uses Web Crypto (HMAC-SHA256, SHA-256).
 */

import { timingSafeEqual } from "node:crypto";

const AUTH_SCHEME = "AWS4-HMAC-SHA256";

function toHex(bytes: ArrayBuffer): string {
  const u = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i++) {
    s += u[i].toString(16).padStart(2, "0");
  }
  return s;
}

async function hmacSha256Raw(
  key: BufferSource,
  data: string | Uint8Array,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const enc: Uint8Array =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : Uint8Array.from(data);
  return crypto.subtle.sign("HMAC", cryptoKey, enc as BufferSource);
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const enc: Uint8Array =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : Uint8Array.from(data);
  const digest = await crypto.subtle.digest("SHA-256", enc as BufferSource);
  return toHex(digest);
}

/** RFC 3986-style percent-encoding for Sig V4 URI path segments (UTF-8 bytes). */
function uriEncodeBytes(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      (b >= 0x30 && b <= 0x39) ||
      b === 0x2d ||
      b === 0x5f ||
      b === 0x2e ||
      b === 0x7e
    ) {
      out += String.fromCharCode(b);
    } else {
      out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

function canonicalUriPath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }
  const segments = pathname.split("/");
  const enc = segments.map((seg, i) => {
    if (seg === "") {
      return i === 0 ? "" : "";
    }
    return uriEncodeBytes(new TextEncoder().encode(seg));
  });
  return enc.join("/") || "/";
}

/** Canonical query string: sort by param name, then value; encode name and value. */
function canonicalQueryString(searchParams: URLSearchParams): string {
  const keys = [...new Set([...searchParams.keys()])].sort((a, b) => {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  });
  const pairs: string[] = [];
  for (const k of keys) {
    const values = searchParams.getAll(k).sort();
    const encK = uriEncodeBytes(new TextEncoder().encode(k));
    if (values.length === 0) {
      pairs.push(`${encK}=`);
    } else {
      for (const v of values) {
        pairs.push(`${encK}=${uriEncodeBytes(new TextEncoder().encode(v))}`);
      }
    }
  }
  return pairs.join("&");
}

function trimHeaderValue(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

export class SigV4Error extends Error {
  readonly name = "SigV4Error";
}

function buildCanonicalHeaders(
  headers: Headers,
  signedHeaderNames: string[],
): { canonical: string; signedLine: string } {
  const lowerToValue = new Map<string, string>();
  for (const [k, v] of headers) {
    const lk = k.toLowerCase();
    if (lk === "authorization") continue;
    const cur = lowerToValue.get(lk);
    const next = trimHeaderValue(v);
    lowerToValue.set(lk, cur ? `${cur},${next}` : next);
  }
  const sorted = [...signedHeaderNames]
    .map((h) => h.toLowerCase().trim())
    .sort();
  let canonical = "";
  for (const name of sorted) {
    const val = lowerToValue.get(name);
    if (val === undefined) {
      throw new SigV4Error(`Signed header ${name} missing from request`);
    }
    canonical += `${name}:${val}\n`;
  }
  const signedLine = sorted.join(";");
  return { canonical, signedLine };
}

export type VerifySignatureV4Credentials = {
  accessKey: string;
  secretKey: string;
};

export type VerifySignatureV4Opts = {
  method: string;
  url: URL;
  headers: Headers;
  /** When body was hashed externally (e.g. after streaming). */
  bodySha256?: string;
};

type ParsedAuth = {
  accessKey: string;
  dateStamp: string;
  region: string;
  service: string;
  signedHeaders: string[];
  signatureHex: string;
};

function parseAuthorizationHeader(raw: string | null): ParsedAuth {
  if (!raw?.startsWith(`${AUTH_SCHEME} `)) {
    throw new SigV4Error("Missing or invalid Authorization scheme");
  }
  const rest = raw.slice(AUTH_SCHEME.length + 1);
  const parts = rest.split(",").map((p) => p.trim());
  let credential = "";
  let signedHeaders = "";
  let signature = "";
  for (const p of parts) {
    if (p.startsWith("Credential=")) credential = p.slice("Credential=".length);
    else if (p.startsWith("SignedHeaders="))
      signedHeaders = p.slice("SignedHeaders=".length);
    else if (p.startsWith("Signature="))
      signature = p.slice("Signature=".length);
  }
  if (!credential || !signedHeaders || !signature) {
    throw new SigV4Error(
      "Authorization header missing Credential, SignedHeaders, or Signature",
    );
  }
  const credParts = credential.split("/");
  if (credParts.length < 5) {
    throw new SigV4Error("Invalid Credential scope");
  }
  const accessKey = credParts[0];
  const dateStamp = credParts[1];
  const region = credParts[2];
  const service = credParts[3];
  if (
    accessKey === undefined ||
    dateStamp === undefined ||
    region === undefined ||
    service === undefined
  ) {
    throw new SigV4Error("Invalid Credential scope");
  }
  const termination = credParts.slice(4).join("/");
  if (termination !== "aws4_request") {
    throw new SigV4Error("Credential scope must end with aws4_request");
  }
  return {
    accessKey,
    dateStamp,
    region,
    service,
    signedHeaders: signedHeaders.split(";").map((s) => s.trim().toLowerCase()),
    signatureHex: signature.toLowerCase(),
  };
}

async function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kSecret = new TextEncoder().encode(`AWS4${secretKey}`);
  const kDate = await hmacSha256Raw(kSecret, dateStamp);
  const kRegion = await hmacSha256Raw(kDate, region);
  const kService = await hmacSha256Raw(kRegion, service);
  return hmacSha256Raw(kService, "aws4_request");
}

/**
 * Verifies `Authorization: AWS4-HMAC-SHA256` for the given request pieces.
 * @returns true if signature matches; false if access key mismatches credentials (no throw).
 */
export async function verifySignatureV4(
  _request: Request,
  opts: VerifySignatureV4Opts,
  credentials: VerifySignatureV4Credentials,
): Promise<boolean> {
  const { method, url, headers } = opts;
  const authRaw = headers.get("Authorization");
  let parsed: ParsedAuth;
  try {
    parsed = parseAuthorizationHeader(authRaw);
  } catch {
    return false;
  }
  if (parsed.accessKey !== credentials.accessKey) {
    return false;
  }

  const payloadHash =
    opts.bodySha256?.trim() ??
    headers.get("x-amz-content-sha256")?.trim() ??
    (await sha256Hex(new Uint8Array(0)));

  const amzDate = headers.get("x-amz-date")?.trim();
  if (!amzDate) {
    return false;
  }

  let canonicalHeadersBlock: string;
  let signedHeadersLine: string;
  try {
    const built = buildCanonicalHeaders(headers, parsed.signedHeaders);
    canonicalHeadersBlock = built.canonical;
    signedHeadersLine = built.signedLine;
  } catch {
    return false;
  }

  const canonicalUri = canonicalUriPath(url.pathname);
  const canonicalQs = canonicalQueryString(url.searchParams);
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQs,
    canonicalHeadersBlock,
    signedHeadersLine,
    payloadHash,
  ].join("\n");

  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const credentialScope = `${parsed.dateStamp}/${parsed.region}/${parsed.service}/aws4_request`;
  const stringToSign = [
    AUTH_SCHEME,
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const signingKey = await deriveSigningKey(
    credentials.secretKey,
    parsed.dateStamp,
    parsed.region,
    parsed.service,
  );
  const sigBuf = await hmacSha256Raw(signingKey, stringToSign);
  const computedHex = toHex(sigBuf);

  if (computedHex.length !== parsed.signatureHex.length) {
    return false;
  }
  try {
    const a = Buffer.from(computedHex, "hex");
    const b = Buffer.from(parsed.signatureHex, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** @internal Exported for unit tests against AWS-published vectors. */
export async function computeSignatureV4ForTests(
  opts: VerifySignatureV4Opts,
  secretKey: string,
  parsed: ParsedAuth,
  payloadHash: string,
): Promise<string> {
  const { method, url, headers } = opts;
  const amzDate = headers.get("x-amz-date")?.trim() ?? "";
  const { canonical, signedLine } = buildCanonicalHeaders(
    headers,
    parsed.signedHeaders,
  );
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUriPath(url.pathname),
    canonicalQueryString(url.searchParams),
    canonical,
    signedLine,
    payloadHash,
  ].join("\n");
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const credentialScope = `${parsed.dateStamp}/${parsed.region}/${parsed.service}/aws4_request`;
  const stringToSign = [
    AUTH_SCHEME,
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");
  const signingKey = await deriveSigningKey(
    secretKey,
    parsed.dateStamp,
    parsed.region,
    parsed.service,
  );
  const sigBuf = await hmacSha256Raw(signingKey, stringToSign);
  return toHex(sigBuf);
}

export function parseAuthorizationHeaderForTests(
  raw: string | null,
): ParsedAuth {
  return parseAuthorizationHeader(raw);
}
