import { randomUUID } from "node:crypto";
import { dispatchAdmin } from "../admin/router";
import { dispatchUiAssets } from "../admin/ui-assets";
import { hasPresignedAuth, verifyPresignedUrl } from "../auth/presigned";
import { verifySignatureV4 } from "../auth/sigv4";
import type { AppContext } from "../server-context";
import { PACKAGE_VERSION } from "../version";
import { s3ErrorXml } from "./errors";
import { handleBucketOnly } from "./handlers/bucket";
import { handleMultipartRequest } from "./handlers/multipart";
import { handleObjectRequest } from "./handlers/object";
import { handleListBuckets } from "./handlers/service";
import { normalizeS3Key } from "./naming";

function normalizePathname(url: URL): string {
  const p = url.pathname || "/";
  if (p === "" || p === "/") return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

/** Loopback, localhost name, or RFC1918 / full 127/8 IPv4 (typical LAN / Docker access). */
function isAllowedHealthHost(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isBucketOrObjectPath(pathname: string): boolean {
  return (
    pathname !== "/" && pathname !== "/_health" && !pathname.startsWith("/_")
  );
}

function withAmzHeaders(
  rid: string,
  init: ResponseInit & { headers?: HeadersInit },
): ResponseInit {
  const h = new Headers(init.headers);
  h.set("x-amz-request-id", rid);
  return { ...init, headers: h };
}

function withRequestId(res: Response, rid: string): Response {
  const h = new Headers(res.headers);
  h.set("x-amz-request-id", rid);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}

async function ensureAuth(
  ctx: AppContext,
  req: Request,
  rid: string,
  method: string,
  url: URL,
): Promise<Response | null> {
  if (ctx.config.insecure) {
    return null;
  }
  const headers = new Headers(req.headers);
  const cred = {
    accessKey: ctx.config.s3.accessKey,
    secretKey: ctx.config.s3.secretKey,
  };

  if (hasPresignedAuth(url)) {
    const ok = await verifyPresignedUrl(req, { method, url }, cred);
    if (!ok) {
      return new Response(
        s3ErrorXml("AccessDenied", "Presigned request verification failed"),
        withAmzHeaders(rid, {
          status: 403,
          headers: { "Content-Type": "application/xml" },
        }),
      );
    }
    return null;
  }

  const ok = await verifySignatureV4(req, { method, url, headers }, cred);
  if (!ok) {
    return new Response(
      s3ErrorXml(
        "SignatureDoesNotMatch",
        "The request signature we calculated does not match the signature you provided.",
      ),
      withAmzHeaders(rid, {
        status: 403,
        headers: { "Content-Type": "application/xml" },
      }),
    );
  }
  return null;
}

function workspaceUnavailable(rid: string): Response {
  return new Response(
    s3ErrorXml(
      "ServiceUnavailable",
      "Gateway workspace is not available. Run: drime-s3 init",
    ),
    withAmzHeaders(rid, {
      status: 503,
      headers: { "Content-Type": "application/xml" },
    }),
  );
}

function corsPreflightResponse(rid: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "x-amz-request-id": rid,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, HEAD",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "3000",
    },
  });
}

function looksLikeAwsRequest(req: Request, url: URL): boolean {
  if (req.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256"))
    return true;
  return hasPresignedAuth(url);
}

function looksLikeBrowserRoot(req: Request, url: URL): boolean {
  if (url.pathname !== "/") return false;
  if (looksLikeAwsRequest(req, url)) return false;
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

/**
 * S3-compatible gateway dispatch (plan Task 11+).
 */
export async function dispatch(
  ctx: AppContext,
  req: Request,
): Promise<Response> {
  const rid = randomUUID();
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const pathname = normalizePathname(url);

  if (pathname.startsWith("/_admin/")) {
    return dispatchAdmin(ctx, req, url);
  }

  if (pathname === "/_ui" || pathname.startsWith("/_ui/")) {
    return dispatchUiAssets(ctx, req, url);
  }

  if (method === "GET" && looksLikeBrowserRoot(req, url)) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/_ui/", "x-amz-request-id": rid },
    });
  }

  if (method === "OPTIONS" && isBucketOrObjectPath(pathname)) {
    return corsPreflightResponse(rid);
  }

  if (method === "GET" && pathname === "/_health") {
    const host = req.headers.get("host") ?? "";
    if (!isAllowedHealthHost(host)) {
      return new Response("Not Found", { status: 404 });
    }
    const body = JSON.stringify({
      status: "ok",
      version: PACKAGE_VERSION,
      folderPathCache: ctx.folderCache.size,
      listTtlCache: ctx.listCache.size,
      listTtlInflight: ctx.listCache.inflightSize,
      multipartSessions: ctx.multipartStore.size,
      webUi: {
        passwordSet: ctx.webUi.enabled,
        activeSessions: ctx.webUi.activeSessions(),
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-amz-request-id": rid,
      },
    });
  }

  const authErr = await ensureAuth(ctx, req, rid, method, url);
  if (authErr) {
    return authErr;
  }

  if (ctx.gatewayWorkspaceId === null) {
    return workspaceUnavailable(rid);
  }

  const W = ctx.gatewayWorkspaceId;

  if (method === "GET" && pathname === "/") {
    const res = await handleListBuckets(ctx, W);
    return withRequestId(res, rid);
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length >= 1) {
    const bucket = decodeURIComponent(segments[0] ?? "");
    const rest = segments.slice(1);

    if (rest.length === 0) {
      const hit = await handleBucketOnly(ctx, {
        method,
        bucket,
        url,
        workspaceId: W,
        req,
      });
      if (hit !== null) {
        return withRequestId(hit, rid);
      }
      return new Response(
        s3ErrorXml("NotImplemented", "This operation is not implemented yet."),
        withAmzHeaders(rid, {
          status: 501,
          headers: { "Content-Type": "application/xml" },
        }),
      );
    }

    const key = normalizeS3Key(
      rest.map((s) => decodeURIComponent(s)).join("/"),
    );
    const objectRes = await handleObjectRequest(ctx, {
      method,
      bucket,
      key,
      url,
      req,
      workspaceId: W,
    });
    if (objectRes !== null) {
      return withRequestId(objectRes, rid);
    }

    const q = url.searchParams;
    if (q.has("uploads") || q.get("uploadId")) {
      const mpRes = await handleMultipartRequest(ctx, {
        method,
        bucket,
        key,
        url,
        req,
        workspaceId: W,
      });
      return withRequestId(mpRes, rid);
    }

    return new Response(
      s3ErrorXml(
        "NotImplemented",
        "This object operation is not implemented yet.",
      ),
      withAmzHeaders(rid, {
        status: 501,
        headers: { "Content-Type": "application/xml" },
      }),
    );
  }

  return new Response("Not Found", {
    status: 404,
    headers: { "x-amz-request-id": rid },
  });
}
