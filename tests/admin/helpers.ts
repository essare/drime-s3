import pino from "pino";
import type { AppConfig } from "../../src/config";
import { dispatch } from "../../src/s3/router";
import { type AppContext, createAppContext } from "../../src/server-context";
import {
  type MockDrimeServer,
  startMockDrime,
} from "../fixtures/mock-drime/server";

export type AdminTestSetup = {
  ctx: AppContext;
  mock: MockDrimeServer;
  call: (req: Request) => Promise<Response>;
  cleanup: () => void;
};

export function adminTestConfig(
  apiBaseUrl: string,
  overrides?: Partial<{
    password: string;
    sessionSecretHex: string;
    insecure: boolean;
  }>,
): AppConfig {
  return {
    s3: { accessKey: "AKIATEST", secretKey: "x".repeat(40), region: "drime" },
    drime: {
      apiKey: "mock-drime-key",
      apiBaseUrl,
      gatewayWorkspaceName: "drime-s3",
    },
    server: { host: "127.0.0.1", port: 8081 },
    webUi: {
      password: overrides?.password ?? "hunter2-hunter2",
      sessionSecret: overrides?.sessionSecretHex ?? "deadbeef".repeat(8),
    },
    insecure: overrides?.insecure ?? true,
  };
}

export async function startAdmin(options?: {
  seedRootFolders?: string[];
  config?: Partial<AppConfig>;
  password?: string;
  sessionSecretHex?: string;
  gatewayWorkspaceName?: string;
}): Promise<AdminTestSetup> {
  const mock = await startMockDrime({
    seedRootFolders: options?.seedRootFolders,
  });
  const cfg = adminTestConfig(mock.baseUrl, {
    password: options?.password,
    sessionSecretHex: options?.sessionSecretHex,
  });
  if (options?.gatewayWorkspaceName) {
    cfg.drime.gatewayWorkspaceName = options.gatewayWorkspaceName;
  }
  const merged = { ...cfg, ...(options?.config ?? {}) } as AppConfig;
  const ctx = await createAppContext({
    config: merged,
    logger: pino({ level: "silent" }),
  });
  return {
    ctx,
    mock,
    call: (req) => dispatch(ctx, req),
    cleanup: () => mock.stop(),
  };
}

/** Logs in and returns the `drime_admin=...` cookie value. Assumes admin enabled. */
export async function loginCookie(
  setup: AdminTestSetup,
  password: string,
): Promise<string> {
  const res = await setup.call(
    new Request("http://127.0.0.1:8081/_admin/login", {
      method: "POST",
      headers: { Host: "127.0.0.1:8081", "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not set a cookie");
  const eq = setCookie.indexOf(";");
  return eq === -1 ? setCookie : setCookie.slice(0, eq);
}
