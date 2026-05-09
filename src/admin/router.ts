import type { AppContext } from "../server-context";
import { checkOrigin, requireSession } from "./auth";
import { jsonError } from "./errors";
import {
  handleCreateBucketAdmin,
  handleDeleteBucketAdmin,
  handleListBucketsAdmin,
} from "./handlers/buckets";
import { handleHealth } from "./handlers/health";
import { handleInit } from "./handlers/init";
import { handleGetSession, handleLogin, handleLogout } from "./handlers/session";
import { handleStatus } from "./handlers/status";

export async function dispatchAdmin(
  ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  const method = req.method.toUpperCase();
  const path = url.pathname;

  if (method === "GET" && path === "/_admin/health") return handleHealth(ctx);

  if (!ctx.webUi.enabled) {
    return jsonError(
      "AdminDisabled",
      "Set WEB_UI_PASSWORD in the environment to enable the admin UI.",
      503,
    );
  }

  const originErr = checkOrigin(req);
  if (originErr) return originErr;

  if (method === "POST" && path === "/_admin/login") return handleLogin(ctx, req, url);
  if (method === "POST" && path === "/_admin/logout") return handleLogout(ctx, req, url);
  if (method === "GET" && path === "/_admin/session") return handleGetSession(ctx, req);

  const sessionErr = await requireSession(ctx, req);
  if (sessionErr) return sessionErr;

  if (method === "GET" && path === "/_admin/status") return handleStatus(ctx);
  if (method === "POST" && path === "/_admin/init") return handleInit(ctx);

  if (path === "/_admin/buckets" && method === "GET") return handleListBucketsAdmin(ctx);
  if (path === "/_admin/buckets" && method === "POST") return handleCreateBucketAdmin(ctx, req);
  const bucketOnly = /^\/_admin\/buckets\/([^/]+)$/.exec(path);
  if (bucketOnly && method === "DELETE") {
    return handleDeleteBucketAdmin(ctx, decodeURIComponent(bucketOnly[1] ?? ""));
  }

  return jsonError("NotFound", `No admin route for ${method} ${path}`, 404);
}
