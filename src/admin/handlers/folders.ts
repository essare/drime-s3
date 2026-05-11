import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import { adminCreateFolder } from "../shared";

function workspaceUnavailable(): Response {
  return jsonError(
    "WorkspaceUnavailable",
    "Gateway workspace not initialized — call POST /_admin/init.",
    503,
  );
}

export async function handleCreateFolderAdmin(
  ctx: AppContext,
  bucket: string,
  url: URL,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();

  let body: { path?: unknown };
  try {
    body = (await req.json()) as { path?: unknown };
  } catch {
    return jsonError("BadRequest", "Body must be JSON.", 400);
  }
  const path = typeof body.path === "string" ? body.path : "";
  if (!path) {
    return jsonError("BadRequest", "Field `path` is required.", 400);
  }

  const prefix = (url.searchParams.get("prefix") ?? "").replace(
    /^\/+|\/+$/g,
    "",
  );

  const r = await adminCreateFolder(
    ctx,
    ctx.gatewayWorkspaceId,
    bucket,
    prefix,
    path,
  );

  if (r.kind === "no-such-bucket") {
    return jsonError(
      "NoSuchBucket",
      "The specified bucket does not exist.",
      404,
    );
  }
  if (r.kind === "no-such-prefix") {
    return jsonError(
      "NoSuchPrefix",
      "Parent prefix no longer exists; refresh the listing.",
      404,
    );
  }
  if (r.kind === "invalid") {
    return jsonError("BadRequest", r.message, 400);
  }
  if (r.kind === "exists") {
    const noun = r.existingKind === "folder" ? "folder" : "object";
    return jsonError(
      "FolderAlreadyExists",
      `A ${noun} named "${path.trim()}" already exists at this location.`,
      409,
      { existingKind: r.existingKind },
    );
  }
  return jsonOk({ name: r.name, prefix: r.prefix }, { status: 201 });
}
