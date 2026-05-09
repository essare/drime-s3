import type { Logger } from "pino";
import pino from "pino";
import {
  createWebUiState,
  deriveSessionSecret,
  type WebUiState,
} from "./admin/state";
import { FolderPathCache } from "./cache/folder-paths";
import { ListTtlCache } from "./cache/list-ttl";
import type { AppConfig } from "./config";
import {
  DrimeClient,
  type DrimeFetchFn,
  GatewayWorkspaceError,
} from "./drime/client";
import { MultipartSessionStore } from "./multipart/session-store";

export type AppContext = {
  config: AppConfig;
  drime: DrimeClient;
  /**
   * Resolved gateway workspace id `W`, or `null` when `resolveGatewayWorkspaceId` failed at bootstrap
   * (e.g. workspace missing — user should run `drime-s3 init`).
   */
  gatewayWorkspaceId: number | null;
  folderCache: FolderPathCache;
  listCache: ListTtlCache;
  multipartStore: MultipartSessionStore;
  webUi: WebUiState;
  logger: Logger;
};

export type CreateAppContextInput = {
  config: AppConfig;
  fetchFn?: DrimeFetchFn;
  logger?: Logger;
};

export async function createAppContext(
  input: CreateAppContextInput,
): Promise<AppContext> {
  const logger =
    input.logger ??
    pino({
      level: "info",
      name: "drime-s3",
    });
  const drime = new DrimeClient({
    apiKey: input.config.drime.apiKey,
    apiBaseUrl: input.config.drime.apiBaseUrl,
    fetchFn: input.fetchFn,
  });

  let gatewayWorkspaceId: number | null = null;
  try {
    gatewayWorkspaceId = await drime.resolveGatewayWorkspaceId({
      name: input.config.drime.gatewayWorkspaceName,
      pinnedId: input.config.drime.gatewayWorkspaceId,
    });
  } catch (e) {
    if (e instanceof GatewayWorkspaceError) {
      logger.warn({ err: e.message }, "gateway workspace not resolved");
    } else {
      throw e;
    }
  }

  let webUi: WebUiState;
  if (input.config.webUi.password.length === 0) {
    webUi = createWebUiState({
      password: "",
      sessionSecret: new Uint8Array(0),
    });
  } else {
    const secret = await deriveSessionSecret(
      input.config.webUi.password,
      input.config.webUi.sessionSecret,
    );
    webUi = createWebUiState({
      password: input.config.webUi.password,
      sessionSecret: secret,
    });
  }

  return {
    config: input.config,
    drime,
    gatewayWorkspaceId,
    folderCache: new FolderPathCache(),
    listCache: new ListTtlCache(),
    multipartStore: new MultipartSessionStore(),
    webUi,
    logger,
  };
}
