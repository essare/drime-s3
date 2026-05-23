import { handleDeleteObjects } from "../../s3/handlers/batch";
import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import {
  adminDeleteObject,
  adminGetObject,
  adminListObjects,
  adminPutObject,
} from "../shared";

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
    return jsonError(
      "NoSuchBucket",
      "The specified bucket does not exist.",
      404,
    );
  }
  const l = r.listing;
  return jsonOk({
    prefix: l.prefix,
    delimiter: l.delimiter,
    objects: l.objects,
    folders: l.folders,
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
  const r = await adminPutObject(ctx, ctx.gatewayWorkspaceId, bucket, key, req);
  if (r.kind === "no-such-bucket") {
    return jsonError(
      "NoSuchBucket",
      "The specified bucket does not exist.",
      404,
    );
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
    ctx,
    ctx.gatewayWorkspaceId,
    bucket,
    key,
    req.headers.get("range"),
  );
}

export async function handleDeleteObjectAdmin(
  ctx: AppContext,
  bucket: string,
  key: string,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const r = await adminDeleteObject(ctx, ctx.gatewayWorkspaceId, bucket, key);
  if (r.kind === "no-such-bucket") {
    return jsonError(
      "NoSuchBucket",
      "The specified bucket does not exist.",
      404,
    );
  }
  if (r.kind === "error") {
    return jsonError(r.code, r.message, r.status);
  }
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handleBatchDeleteAdmin(
  ctx: AppContext,
  bucket: string,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  let body: { keys?: unknown };
  try {
    body = (await req.json()) as { keys?: unknown };
  } catch {
    return jsonError("BadRequest", "Body must be JSON.", 400);
  }
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    return jsonError(
      "BadRequest",
      "Field `keys` must be a non-empty array.",
      400,
    );
  }
  if (body.keys.length > 1000) {
    return jsonError("BadRequest", "At most 1000 keys per batch.", 400);
  }
  const keys = body.keys.map(String);

  const xmlEntries = keys
    .map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`)
    .join("");
  const bodyText = `<?xml version="1.0" encoding="UTF-8"?><Delete>${xmlEntries}</Delete>`;
  const res = await handleDeleteObjects(ctx, {
    bucket,
    bodyText,
    workspaceId: ctx.gatewayWorkspaceId,
  });

  const xml = await res.text();
  const deleted: string[] = [];
  const errors: { key: string; code: string; message: string }[] = [];
  for (const m of xml.matchAll(/<Deleted>(?:[\s\S]*?<Key>([^<]+)<\/Key>)/g)) {
    if (m[1]) deleted.push(m[1]);
  }
  for (const m of xml.matchAll(
    /<Error>(?:[\s\S]*?<Key>([^<]+)<\/Key>)(?:[\s\S]*?<Code>([^<]+)<\/Code>)?(?:[\s\S]*?<Message>([^<]*)<\/Message>)?/g,
  )) {
    errors.push({
      key: m[1] ?? "",
      code: m[2] ?? "InternalError",
      message: m[3] ?? "",
    });
  }
  return jsonOk({ deleted, errors });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
