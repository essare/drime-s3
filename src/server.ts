import type { Logger } from "pino";
import { dispatch } from "./s3/router";
import type { AppContext } from "./server-context";

export type GatewayServer = ReturnType<typeof Bun.serve>;

// S3 single-PUT max is 5 GiB; the admin UI also caps uploads at 5 GiB.
// Bun's default maxRequestBodySize is 128 MiB which truncates larger uploads
// and forcibly closes the upstream socket (manifests as `EPIPE` in proxies).
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024 * 1024;

// Default idleTimeout is 10 s, which is too aggressive for large streaming
// uploads (spool-to-disk + Drime upload). 255 s is the maximum allowed by Bun.
const IDLE_TIMEOUT_SECONDS = 255;

/**
 * Starts `Bun.serve` with S3 dispatch. Caller owns `AppContext` lifetime (stop the server before dropping context).
 */
export function startGateway(
  ctx: AppContext,
  opts: { logger?: Logger },
): GatewayServer {
  const logger = opts.logger;
  const server = Bun.serve({
    hostname: ctx.config.server.host,
    port: ctx.config.server.port,
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    async fetch(req) {
      try {
        return await dispatch(ctx, req);
      } catch (err) {
        logger?.error({ err }, "dispatch failed");
        return new Response("Internal Server Error", { status: 500 });
      }
    },
  });
  const url =
    server.url?.href ?? `http://${ctx.config.server.host}:${server.port}/`;
  logger?.info({ url }, "drime-s3 gateway listening");
  return server;
}
