import { runInit } from "../../cli/init";
import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";

export async function handleInit(ctx: AppContext): Promise<Response> {
  if (!ctx.config.drime.apiKey) {
    return jsonError(
      "DrimeApiKeyMissing",
      "Set DRIME_API_KEY in the environment before initializing.",
      400,
    );
  }
  try {
    const id = await runInit(ctx.config);
    (ctx as { gatewayWorkspaceId: number | null }).gatewayWorkspaceId = id;
    return jsonOk({ workspaceId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError("InitFailed", msg, 502);
  }
}
