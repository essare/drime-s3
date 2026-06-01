import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import { adminGetStats } from "../shared";

function workspaceUnavailable(): Response {
  return jsonError(
    "WorkspaceUnavailable",
    "Gateway workspace not initialized — call POST /_admin/init.",
    503,
  );
}

export async function handleStatsAdmin(
  ctx: AppContext,
  url: URL,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();
  const accurate = url.searchParams.get("accurate") === "true";
  const stats = await adminGetStats(ctx, ctx.gatewayWorkspaceId, { accurate });
  return jsonOk(stats);
}
