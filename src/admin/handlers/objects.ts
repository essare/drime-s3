import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import { adminListObjects } from "../shared";

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
