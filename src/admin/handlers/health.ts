import type { AppContext } from "../../server-context";
import { jsonOk } from "../errors";

const VERSION = "0.0.0"; // sourced from package.json at build time in v1.1
export async function handleHealth(ctx: AppContext): Promise<Response> {
  return jsonOk({
    ok: true,
    version: VERSION,
    hasPassword: ctx.webUi.enabled,
  });
}
