import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AppContext } from "../server-context";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/** Extensions treated as static assets (no SPA HTML shell for missing files). */
const KNOWN_ASSET_EXT = new Set([
  ".js",
  ".mjs",
  ".css",
  ".svg",
  ".png",
  ".ico",
  ".webp",
  ".woff2",
  ".json",
  ".map",
  ".txt",
  ".gif",
  ".jpg",
  ".jpeg",
  ".html",
  ".wasm",
]);

function uiRoot(): string {
  return path.resolve(import.meta.dir, "../..", "web", "dist");
}

function mimeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

function cacheHeaders(normalized: string): Record<string, string> {
  if (normalized === "/index.html") return { "Cache-Control": "no-cache" };
  if (normalized.startsWith("/assets/")) {
    return { "Cache-Control": "public, max-age=31536000, immutable" };
  }
  return { "Cache-Control": "public, max-age=3600" };
}

function safeNormalize(rawPath: string): string | null {
  let rest = rawPath.replace(/^\/_ui/, "");
  if (rest.includes("\\")) return null;
  if (rest === "" || rest === "/") return "/index.html";
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (rest.includes("\\")) return null;
  if (!rest.startsWith("/")) return null;
  const segments = rest.split("/");
  if (segments.some((seg) => seg === "..")) return null;
  return rest;
}

function resolvedFileUnderRoot(
  root: string,
  normalized: string,
): string | null {
  const rel = normalized.replace(/^\//, "");
  const fsPath = path.join(root, rel);
  const resolvedFile = path.resolve(fsPath);
  const resolvedRoot = path.resolve(root);
  if (
    resolvedFile !== resolvedRoot &&
    !resolvedFile.startsWith(resolvedRoot + path.sep)
  ) {
    return null;
  }
  return resolvedFile;
}

async function serveFile(
  diskPath: string,
  normalized: string,
  headOnly: boolean,
): Promise<Response> {
  const file = Bun.file(diskPath);
  const headers = new Headers({
    "Content-Type": mimeFor(normalized),
    ...cacheHeaders(normalized),
  });
  if (headOnly) {
    headers.set("Content-Length", String(file.size));
    return new Response(null, { status: 200, headers });
  }
  return new Response(file, { status: 200, headers });
}

async function tryServePath(
  root: string,
  req: Request,
  normalized: string,
): Promise<Response | null> {
  const headOnly = req.method === "HEAD";
  const fsPath = resolvedFileUnderRoot(root, normalized);
  if (fsPath && existsSync(fsPath) && statSync(fsPath).isFile()) {
    return serveFile(fsPath, normalized, headOnly);
  }
  return null;
}

async function dispatchUiAssetsImpl(
  root: string,
  _ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const normalized = safeNormalize(url.pathname);
  if (normalized === null) {
    return new Response("Bad Request", { status: 400 });
  }

  const direct = await tryServePath(root, req, normalized);
  if (direct) return direct;

  const accept = req.headers.get("Accept") ?? "";
  const ext = path.extname(normalized).toLowerCase();
  const isKnownAssetExt = KNOWN_ASSET_EXT.has(ext);

  if (accept.includes("text/html") && !isKnownAssetExt) {
    const indexPath = resolvedFileUnderRoot(root, "/index.html");
    if (indexPath && existsSync(indexPath) && statSync(indexPath).isFile()) {
      return serveFile(indexPath, "/index.html", req.method === "HEAD");
    }
  }

  return new Response("Not Found", { status: 404 });
}

export async function dispatchUiAssets(
  ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  return dispatchUiAssetsImpl(uiRoot(), ctx, req, url);
}

/** Test seam: fixed UI root (tests avoid relying on repo `web/dist`). */
export async function __test__dispatchUiAssetsAt(
  root: string,
  ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  return dispatchUiAssetsImpl(root, ctx, req, url);
}

/** URL parsers normalize `..` before routing; tests call this to verify path rules. */
export function __test__safeNormalizePath(pathname: string): string | null {
  return safeNormalize(pathname);
}
