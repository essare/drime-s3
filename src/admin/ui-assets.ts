import type { AppContext } from "../server-context";

/**
 * Stub: returns 404 in Plan A. Plan B replaces this with a real serve-from-embedded
 * + serve-from-disk implementation.
 */
export async function dispatchUiAssets(
  _ctx: AppContext,
  _req: Request,
  _url: URL,
): Promise<Response> {
  return new Response("Not Found", { status: 404 });
}
