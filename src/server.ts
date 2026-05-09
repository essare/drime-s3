import type { Logger } from "pino";
import { dispatch } from "./s3/router";
import type { AppContext } from "./server-context";

export type GatewayServer = ReturnType<typeof Bun.serve>;

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
