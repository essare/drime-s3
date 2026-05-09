import { findWorkspaceIdByName } from "../../drime/workspace";
import type { AppContext } from "../../server-context";
import { jsonOk } from "../errors";

export async function handleStatus(ctx: AppContext): Promise<Response> {
  const env = {
    drimeApiKeySet: ctx.config.drime.apiKey.length > 0,
    drimeApiBaseUrl: ctx.config.drime.apiBaseUrl,
    s3KeysSet:
      ctx.config.s3.accessKey.length > 0 && ctx.config.s3.secretKey.length > 0,
    region: ctx.config.s3.region,
    webUiPasswordSet: ctx.webUi.enabled,
  };

  const t0 = performance.now();
  let reachable = false;
  let latencyMs = 0;
  let error: string | undefined;
  let workspaceId: number | null = null;
  try {
    const rows = await ctx.drime.listWorkspaces();
    latencyMs = Math.round(performance.now() - t0);
    reachable = true;
    const found = findWorkspaceIdByName(
      rows,
      ctx.config.drime.gatewayWorkspaceName,
    );
    workspaceId = typeof found === "number" ? found : null;
  } catch (e) {
    latencyMs = Math.round(performance.now() - t0);
    error = e instanceof Error ? e.message : String(e);
  }

  return jsonOk({
    env,
    drime: error ? { reachable, latencyMs, error } : { reachable, latencyMs },
    workspace: {
      name: ctx.config.drime.gatewayWorkspaceName,
      id: workspaceId,
      exists: workspaceId !== null,
    },
  });
}
