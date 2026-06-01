import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import { adminGetObjectCounts } from "../shared";

function workspaceUnavailable(): Response {
  return jsonError(
    "WorkspaceUnavailable",
    "Gateway workspace not initialized — call POST /_admin/init.",
    503,
  );
}

export async function handleStatsObjectCountsAdmin(
  ctx: AppContext,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const counts = await adminGetObjectCounts(ctx, ctx.gatewayWorkspaceId);
  return jsonOk(counts);
}
