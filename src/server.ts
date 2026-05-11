import type { Logger } from "pino";
import { dispatch } from "./s3/router";
import type { AppContext } from "./server-context";

function httpTraceEnabled(): boolean {
  const v = process.env.DRIME_S3_HTTP_TRACE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function httpTraceVerbose(): boolean {
  const v = process.env.DRIME_S3_HTTP_TRACE_VERBOSE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function isDuplicatiPrivilegesProbe(pathname: string): boolean {
  return pathname.includes("duplicati-access-privileges-test");
}

/** Strip weak ETag prefix and quotes; return whether inner value is 32-char hex. */
function etagMd5ShapeOk(etagHeader: string): boolean {
  const inner = etagHeader
    .replace(/^W\//i, "")
    .replace(/^"+|"+$/g, "")
    .trim();
  return /^[a-f0-9]{32}$/i.test(inner);
}

/** Safe Sig V4 hints + optional full response header map for debugging third-party clients. */
function s3TraceExtras(
  req: Request,
  res: Response,
  pathname: string,
): Record<string, unknown> {
  const etagHdr = res.headers.get("etag") ?? "";
  const out: Record<string, unknown> = {
    host: req.headers.get("host") ?? "",
    reqContentType: req.headers.get("content-type") ?? "",
    resContentType: res.headers.get("content-type") ?? "",
    lastModified: res.headers.get("last-modified") ?? "",
    etagMd5ShapeOk: etagHdr.length > 0 ? etagMd5ShapeOk(etagHdr) : null,
  };

  if (isDuplicatiPrivilegesProbe(pathname)) {
    out.duplicatiPrivilegesProbe = true;
  }

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("AWS4-HMAC-SHA256")) {
    const m = auth.match(/Credential=([^/\s,]+)/);
    const fullKey = m?.[1];
    out.sigv4AccessKeyId =
      fullKey !== undefined && fullKey.length > 0 ? fullKey : "(parse failed)";
    const scope = auth.match(/Credential=[^/]+\/([^/]+\/[^/]+\/[^/]+)\//);
    out.sigv4CredentialScope = scope?.[1] ?? "";
  }

  out.amzDate = req.headers.get("x-amz-date") ?? "";
  out.amzContentSha256 = req.headers.get("x-amz-content-sha256") ?? "";

  if (httpTraceVerbose()) {
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    out.responseHeaders = responseHeaders;
  }

  return out;
}

function shouldTracePath(pathname: string): boolean {
  if (pathname === "/_health") return false;
  if (pathname.startsWith("/_admin")) return false;
  if (pathname.startsWith("/_ui")) return false;
  return true;
}

export type GatewayServer = ReturnType<typeof Bun.serve>;

// S3 single-PUT max is 5 GiB; the admin UI also caps uploads at 5 GiB.
// Bun's default maxRequestBodySize is 128 MiB which truncates larger uploads
// and forcibly closes the upstream socket (manifests as `EPIPE` in proxies).
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024 * 1024;

// Default idleTimeout is 10 s, which is too aggressive for large streaming
// uploads (spool-to-disk + Drime upload). 255 s is the maximum allowed by Bun.
const IDLE_TIMEOUT_SECONDS = 255;

/**
 * Starts `Bun.serve` with S3 dispatch. Caller owns `AppContext` lifetime (stop the server before dropping context).
 */
export function startGateway(
  ctx: AppContext,
  opts: { logger?: Logger },
): GatewayServer {
  const logger = opts.logger;
  const server = Bun.serve({
    hostname: ctx.config.server.host,
    port: ctx.config.server.port,
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    async fetch(req) {
      try {
        const res = await dispatch(ctx, req);
        if (logger && httpTraceEnabled()) {
          const u = new URL(req.url);
          if (shouldTracePath(u.pathname)) {
            logger.info(
              {
                ...s3TraceExtras(req, res, u.pathname),
                method: req.method,
                path: u.pathname + u.search,
                status: res.status,
                etag: res.headers.get("etag") ?? "",
                contentLength: res.headers.get("content-length") ?? "",
                requestId: res.headers.get("x-amz-request-id") ?? "",
              },
              "s3 http trace",
            );
          }
        }
        return res;
      } catch (err) {
        logger?.error({ err }, "dispatch failed");
        return new Response("Internal Server Error", { status: 500 });
      }
    },
  });
  const url =
    server.url?.href ?? `http://${ctx.config.server.host}:${server.port}/`;
  logger?.info({ url }, "drime-s3 gateway listening");
  return server;
}
