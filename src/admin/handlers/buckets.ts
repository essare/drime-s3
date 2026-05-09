import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import {
  adminCreateBucket,
  adminDeleteBucket,
  adminListBuckets,
} from "../shared";

function workspaceUnavailable(): Response {
  return jsonError(
    "WorkspaceUnavailable",
    "Gateway workspace not initialized — call POST /_admin/init.",
    503,
  );
}

export async function handleListBucketsAdmin(ctx: AppContext): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const buckets = await adminListBuckets(ctx, ctx.gatewayWorkspaceId);
  return jsonOk({ buckets, count: buckets.length });
}

export async function handleCreateBucketAdmin(
  ctx: AppContext,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  let body: { name?: unknown };
  try {
    body = (await req.json()) as { name?: unknown };
  } catch {
    return jsonError("BadRequest", "Body must be JSON.", 400);
  }
  const name = typeof body.name === "string" ? body.name : "";
  const r = await adminCreateBucket(ctx, ctx.gatewayWorkspaceId, name);
  if (r.kind === "invalid-name") {
    return jsonError("InvalidBucketName", "The specified bucket name is not valid.", 400);
  }
  if (r.kind === "exists") {
    return jsonError("BucketAlreadyExists", "The requested bucket name is not available.", 409);
  }
  return jsonOk({ name }, 201);
}

export async function handleDeleteBucketAdmin(
  ctx: AppContext,
  bucket: string,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const r = await adminDeleteBucket(ctx, ctx.gatewayWorkspaceId, bucket);
  if (r.kind === "missing") {
    return jsonError("NoSuchBucket", "The specified bucket does not exist.", 404);
  }
  if (r.kind === "not-empty") {
    return jsonError("BucketNotEmpty", "The bucket you tried to delete is not empty.", 409);
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
