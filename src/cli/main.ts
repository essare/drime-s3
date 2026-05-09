#!/usr/bin/env bun
import { ConfigError, loadConfig, resolveConfigPath } from "../config";
import { startGateway } from "../server";
import { createAppContext } from "../server-context";
import { assertSafeInsecureBind } from "./bind-check";
import { runInit } from "./init";
import { applyCliOverridesToConfig, parseGlobalFlags } from "./parse-args";

async function loadMergedConfig(
  flags: ReturnType<typeof parseGlobalFlags>["flags"],
) {
  const cfg = await loadConfig({ configPath: flags.configPath });
  applyCliOverridesToConfig(cfg, flags);
  return cfg;
}

async function runPrintConfig(
  flags: ReturnType<typeof parseGlobalFlags>["flags"],
): Promise<void> {
  const cfg = await loadMergedConfig(flags);
  const p = resolveConfigPath(flags.configPath);
  const file = Bun.file(p);
  const exists = await file.exists();
  const out = {
    configFile: p,
    configFileExists: exists,
    insecure: cfg.insecure,
    server: cfg.server,
    drime: {
      apiBaseUrl: cfg.drime.apiBaseUrl,
      apiKeySet: Boolean(cfg.drime.apiKey),
      gatewayWorkspaceName: cfg.drime.gatewayWorkspaceName,
      gatewayWorkspaceId: cfg.drime.gatewayWorkspaceId ?? null,
    },
    s3: {
      accessKey: cfg.s3.accessKey,
      secretKey:
        cfg.s3.secretKey.length > 0
          ? `${cfg.s3.secretKey.slice(0, 4)}…(redacted)`
          : "",
      region: cfg.s3.region,
    },
  };
  console.log(JSON.stringify(out, null, 2));
}

function printHelp(): void {
  console.log(`drime-s3 — S3-compatible gateway for Drime Cloud

Usage:
  drime-s3 init [options]     Create the gateway workspace if missing (Drime API).
  drime-s3 serve [options]    Start the HTTP gateway (default ${resolveConfigPath()}).
  drime-s3 print-config       Print merged configuration (secrets redacted).

Global options:
  --config <path>             TOML config file (default: ~/.config/drime-s3/config.toml)
  --insecure                  Skip S3 Sig V4 verification (dev only; see design §6.3)
  --i-know-what-im-doing      Allow --insecure with a non-loopback bind (dangerous)
  --host <hostname>           Override [server] host
  --port <port>               Override [server] port

Environment (common):
  DRIME_API_KEY               Drime bearer token (required for init and real uploads)
  DRIME_API_BASE_URL          Drime API base (default https://app.drime.cloud/api/v1)
  DRIME_S3_INSECURE=1         Same as --insecure
  DRIME_GATEWAY_WORKSPACE_NAME   Workspace whose root folders are buckets (default drime-s3)
  S3_ACCESS_KEY / S3_SECRET_KEY    S3 credentials clients use (auto-generated if insecure)

Example (local dev against real Drime):
  export DRIME_API_KEY=...
  export DRIME_S3_INSECURE=1
  bun run src/cli/main.ts init
  bun run src/cli/main.ts serve
  # other terminal:
  DRIME_S3_INSECURE=1 bun run scripts/real-upload-smoke.ts http://127.0.0.1:8081
  # large multipart (AWS CLI): place scripts/bin/payload.bin, then:
  DRIME_S3_ENDPOINT=http://127.0.0.1:8081 bun run scripts/real-large-s3-upload.ts
`);
}

async function main(): Promise<void> {
  const [, , ...argv] = process.argv;
  const { flags, positional } = parseGlobalFlags(argv);
  const cmd = positional[0];

  if (cmd === undefined || cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp();
    process.exit(0);
  }

  try {
    if (cmd === "print-config") {
      await runPrintConfig(flags);
      process.exit(0);
    }

    if (cmd === "init") {
      const cfg = await loadMergedConfig(flags);
      const id = await runInit(cfg);
      console.log(
        `Gateway workspace "${cfg.drime.gatewayWorkspaceName}" is ready (id ${id}).`,
      );
      console.log("Start the gateway with: bun run src/cli/main.ts serve");
      process.exit(0);
    }

    if (cmd === "serve") {
      const cfg = await loadMergedConfig(flags);
      assertSafeInsecureBind(cfg, flags.iKnowWhatImDoing);
      if (cfg.insecure) {
        console.warn(
          "*** DRIME_S3 INSECURE: S3 request authentication is NOT verified. Do not expose this process publicly without TLS and Sig V4. ***",
        );
      }
      const ctx = await createAppContext({ config: cfg });
      const server = startGateway(ctx, { logger: ctx.logger });
      console.log("Press Ctrl+C to stop.");
      await new Promise<void>((resolve) => {
        const stop = () => {
          server.stop();
          resolve();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      process.exit(0);
    }

    console.error(`Unknown command: ${cmd}`);
    printHelp();
    process.exit(1);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

await main();
