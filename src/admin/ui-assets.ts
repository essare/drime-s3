import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AppContext } from "../server-context";

/**
 * Static UI for `/_ui/*`.
 *
 * **Development:** serves files from `web/dist` next to the repo (`import.meta.dir`).
 *
 * **Compiled binary (`bun build --compile`):** Bun 1.3.x does not expose a stable
 * `--embed` glob flag in the CLI; hashed embed names from `import { type: "file" }`
 * also fight Vite's own content hashes. Release builds therefore copy `web/dist`
 * to `dist/web/dist` alongside the executable (`build-release.ts`). At runtime we
 * resolve `dirname(process.execPath)/web/dist` after checking optional
 * `Bun.embeddedFiles` entries (non-empty when additional embed imports exist).
 */

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

function adjacentUiRoot(): string {
  return path.join(path.dirname(process.execPath), "web", "dist");
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

/**
 * Match `Bun.embeddedFiles` entries to logical URL paths. Bun may rename embedded
 * files; match by basename and `stem-{suffix}.ext` patterns.
 */
/** Bun attaches `name` to embedded file blobs (see Bun.embeddedFiles docs). */
type EmbeddedBlob = Blob & { readonly name: string };

function findEmbeddedBlob(normalized: string): Blob | undefined {
  const base = path.basename(normalized);
  const ext = path.extname(normalized);
  const stem = ext.length > 0 ? base.slice(0, -ext.length) : base;
  for (const blob of Bun.embeddedFiles as readonly EmbeddedBlob[]) {
    if (blob.name === base) return blob;
    if (
      ext.length > 0 &&
      blob.name.startsWith(`${stem}-`) &&
      blob.name.endsWith(ext)
    ) {
      return blob;
    }
  }
  return undefined;
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

function serveBlob(
  blob: Blob,
  normalized: string,
  headOnly: boolean,
): Response {
  const headers = new Headers({
    "Content-Type": mimeFor(normalized),
    ...cacheHeaders(normalized),
  });
  if (headOnly) {
    headers.set("Content-Length", String(blob.size));
    return new Response(null, { status: 200, headers });
  }
  return new Response(blob, { status: 200, headers });
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

function tryServeEmbedded(
  normalized: string,
  headOnly: boolean,
): Response | null {
  const blob = findEmbeddedBlob(normalized);
  if (!blob) return null;
  return serveBlob(blob, normalized, headOnly);
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
  opts: { includeAdjacent: boolean },
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

  const headOnly = req.method === "HEAD";

  const embedded = tryServeEmbedded(normalized, headOnly);
  if (embedded) return embedded;

  const primary = await tryServePath(root, req, normalized);
  if (primary) return primary;

  if (opts.includeAdjacent) {
    const adj = await tryServePath(adjacentUiRoot(), req, normalized);
    if (adj) return adj;
  }

  const accept = req.headers.get("Accept") ?? "";
  const ext = path.extname(normalized).toLowerCase();
  const isKnownAssetExt = KNOWN_ASSET_EXT.has(ext);

  if (accept.includes("text/html") && !isKnownAssetExt) {
    const shellEmb = tryServeEmbedded("/index.html", headOnly);
    if (shellEmb) return shellEmb;

    const indexPrimary = resolvedFileUnderRoot(root, "/index.html");
    if (
      indexPrimary &&
      existsSync(indexPrimary) &&
      statSync(indexPrimary).isFile()
    ) {
      return serveFile(indexPrimary, "/index.html", headOnly);
    }

    if (opts.includeAdjacent) {
      const indexAdj = resolvedFileUnderRoot(adjacentUiRoot(), "/index.html");
      if (indexAdj && existsSync(indexAdj) && statSync(indexAdj).isFile()) {
        return serveFile(indexAdj, "/index.html", headOnly);
      }
    }
  }

  return new Response("Not Found", { status: 404 });
}

export async function dispatchUiAssets(
  ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  return dispatchUiAssetsImpl(
    uiRoot(),
    { includeAdjacent: true },
    ctx,
    req,
    url,
  );
}

/** Test seam: fixed UI root; skips adjacent-binary lookup (avoids accidental hits). */
export async function __test__dispatchUiAssetsAt(
  root: string,
  ctx: AppContext,
  req: Request,
  url: URL,
): Promise<Response> {
  return dispatchUiAssetsImpl(root, { includeAdjacent: false }, ctx, req, url);
}

/** URL parsers normalize `..` before routing; tests call this to verify path rules. */
export function __test__safeNormalizePath(pathname: string): string | null {
  return safeNormalize(pathname);
}
