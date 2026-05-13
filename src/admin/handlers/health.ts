import type { AppContext } from "../../server-context";
import { PACKAGE_VERSION } from "../../version";
import { jsonOk } from "../errors";

export async function handleHealth(ctx: AppContext): Promise<Response> {
  return jsonOk({
    ok: true,
    version: PACKAGE_VERSION,
    hasPassword: ctx.webUi.enabled,
  });
}
