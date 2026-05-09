import type { AppContext } from "../server-context";
import { jsonError } from "./errors";
import { handleHealth } from "./handlers/health";

export async function dispatchAdmin(
  ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  const method = req.method.toUpperCase();
  const path = url.pathname;

  // Public health is always available, even without WEB_UI_PASSWORD.
  if (method === "GET" && path === "/_admin/health") {
    return handleHealth(ctx);
  }

  if (!ctx.webUi.enabled) {
    return jsonError(
      "AdminDisabled",
      "Set WEB_UI_PASSWORD in the environment to enable the admin UI.",
      503,
    );
  }

  // Real route table grows in later tasks.
  return jsonError("NotFound", `No admin route for ${method} ${path}`, 404);
}
