import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import { adminGetObject, adminListObjects, adminPutObject } from "../shared";

function workspaceUnavailable(): Response {
  return jsonError(
    "WorkspaceUnavailable",
    "Gateway workspace not initialized — call POST /_admin/init.",
    503,
  );
}

export async function handleListObjectsAdmin(
  ctx: AppContext,
  bucket: string,
  url: URL,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const sp = url.searchParams;
  const r = await adminListObjects(ctx, ctx.gatewayWorkspaceId, bucket, {
    prefix: sp.get("prefix") ?? undefined,
    delimiter: sp.get("delimiter") ?? undefined,
    token: sp.get("token") ?? undefined,
    max: sp.has("max") ? Number(sp.get("max")) : undefined,
  });
  if (r.kind === "no-such-bucket") {
    return jsonError("NoSuchBucket", "The specified bucket does not exist.", 404);
  }
  const l = r.listing;
  return jsonOk({
    prefix: l.prefix,
    delimiter: l.delimiter,
    objects: l.objects,
    commonPrefixes: l.commonPrefixes,
    nextToken: l.nextToken,
  });
}

export async function handlePutObjectAdmin(
  ctx: AppContext,
  bucket: string,
  key: string,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const cl = req.headers.get("content-length");
  const len = cl === null ? null : Number.parseInt(cl, 10);
  const ct = req.headers.get("content-type");
  const r = await adminPutObject(
    ctx,
    ctx.gatewayWorkspaceId,
    bucket,
    key,
    req.body,
    ct,
    Number.isFinite(len) ? (len as number) : null,
  );
  if (r.kind === "no-such-bucket") {
    return jsonError("NoSuchBucket", "The specified bucket does not exist.", 404);
  }
  if (r.kind === "invalid") {
    return jsonError("BadRequest", r.message, 400);
  }
  if (r.kind === "error") {
    return jsonError(r.code, r.message, r.status);
  }
  return jsonOk({ etag: r.etag, size: r.size });
}

export async function handleGetObjectAdmin(
  ctx: AppContext,
  bucket: string,
  key: string,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  return adminGetObject(
    ctx, ctx.gatewayWorkspaceId, bucket, key,
    req.headers.get("range"),
  );
}
