import type { AppConfig } from "../config";
import { DrimeClient } from "../drime/client";

export async function runInit(cfg: AppConfig): Promise<number> {
  if (!cfg.drime.apiKey) {
    throw new Error(
      "Drime API key missing: set [drime] api_key in config or DRIME_API_KEY in the environment.",
    );
  }
  const drime = new DrimeClient({
    apiKey: cfg.drime.apiKey,
    apiBaseUrl: cfg.drime.apiBaseUrl,
  });
  return drime.ensureGatewayWorkspace(cfg.drime.gatewayWorkspaceName);
}
