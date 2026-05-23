import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import { adminFolderStatsBatch, FOLDER_STATS_MAX_PREFIXES } from "../shared";

function workspaceUnavailable(): Response {
  return jsonError(
    "WorkspaceUnavailable",
    "Gateway workspace not initialized — call POST /_admin/init.",
    503,
  );
}

export async function handleFolderStatsAdmin(
  ctx: AppContext,
  bucket: string,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();

  let body: { prefixes?: unknown };
  try {
    body = (await req.json()) as { prefixes?: unknown };
  } catch {
    return jsonError("BadRequest", "Body must be JSON.", 400);
  }

  if (!Array.isArray(body.prefixes)) {
    return jsonError("BadRequest", "Field `prefixes` must be an array.", 400);
  }

  const prefixes: string[] = [];
  for (const item of body.prefixes) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return jsonError(
        "BadRequest",
        "Each prefix must be a non-empty string.",
        400,
      );
    }
    if (item.includes("..")) {
      return jsonError("BadRequest", "Invalid prefix.", 400);
    }
    prefixes.push(item);
  }

  if (prefixes.length === 0) {
    return jsonOk({ stats: [] });
  }

  const r = await adminFolderStatsBatch(
    ctx,
    ctx.gatewayWorkspaceId,
    bucket,
    prefixes,
  );

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

  return jsonOk({ stats: r.stats });
}

export { FOLDER_STATS_MAX_PREFIXES };
