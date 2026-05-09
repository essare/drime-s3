#!/usr/bin/env bun
/**
 * Starts mock Drime + gateway on a free port, runs `multipart-smoke.ts`, then exits.
 * Used in CI / local verification without a manual second terminal.
 */
import pino from "pino";
import { startGateway } from "../src/server";
import { createAppContext } from "../src/server-context";
import { startMockDrime } from "../tests/fixtures/mock-drime/server";

const mock = await startMockDrime();

const ctx = await createAppContext({
  config: {
    s3: {
      accessKey: "AKIATEST",
      secretKey: "test-secret-test-secret-test-secret",
      region: "drime",
    },
    drime: {
      apiKey: "mock-drime-key",
      apiBaseUrl: mock.baseUrl,
      gatewayWorkspaceName: "drime-s3",
    },
    server: { host: "127.0.0.1", port: 0 },
    insecure: true,
  },
  logger: pino({ level: "silent" }),
});

const gw = startGateway(ctx, {});
const port = gw.port;
const base = `http://127.0.0.1:${port}`;

const smokeScript = `${import.meta.dir}/multipart-smoke.ts`;
const proc = Bun.spawn({
  cmd: [process.execPath, smokeScript, base],
  stdout: "inherit",
  stderr: "inherit",
});
const code = await proc.exited;

gw.stop();
mock.stop();
process.exit(code === 0 ? 0 : 1);
