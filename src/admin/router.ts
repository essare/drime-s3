import type { AppContext } from "../server-context";
import { jsonError } from "./errors";
import { handleHealth } from "./handlers/health";
import { handleGetSession, handleLogin, handleLogout } from "./handlers/session";

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

  if (method === "POST" && path === "/_admin/login") {
    return handleLogin(ctx, req, url);
  }
  if (method === "POST" && path === "/_admin/logout") {
    return handleLogout(ctx, req, url);
  }
  if (method === "GET" && path === "/_admin/session") {
    return handleGetSession(ctx, req);
  }

  // Real route table grows in later tasks.
  return jsonError("NotFound", `No admin route for ${method} ${path}`, 404);
}
