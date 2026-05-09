#!/usr/bin/env bun
/**
 * E2E for `real-large-s3-upload.ts`: mock Drime + gateway (Sig V4 on), temp config with fixed S3 keys,
 * sparse 10 MiB `scripts/bin/payload.bin`, then `aws s3 cp` up and down (multipart on AWS CLI v1).
 */
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { loadConfig } from "../src/config";
import { startGateway } from "../src/server";
import { createAppContext } from "../src/server-context";
import { startMockDrime } from "../tests/fixtures/mock-drime/server";

const mock = await startMockDrime();
const port = 27000 + Math.floor(Math.random() * 9000);
const tomlPath = join("/tmp", `drime-s3-large-aws-${Date.now()}.toml`);
const toml = `
[s3]
access_key = "AKIALARGETEST001"
secret_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
region = "drime"

[drime]
api_key = "mock-drime-key"
api_base_url = "${mock.baseUrl}"
gateway_workspace_name = "drime-s3"

[server]
host = "127.0.0.1"
port = ${port}
`.trimStart();

await writeFile(tomlPath, toml, "utf8");

const cfg = await loadConfig({ configPath: tomlPath });
const ctx = await createAppContext({
  config: cfg,
  logger: pino({ level: "silent" }),
});
const gw = startGateway(ctx, {});
const bound = gw.port;
const endpoint = `http://127.0.0.1:${bound}`;

const binPath = join(import.meta.dir, "bin", "payload.bin");
await rm(binPath, { force: true }).catch(() => {});
const trunc = Bun.spawnSync({
  cmd: ["truncate", "-s", "10485760", binPath],
  stderr: "pipe",
  stdout: "pipe",
});
if (trunc.exitCode !== 0) {
  const m = new TextDecoder().decode(trunc.stderr);
  throw new Error(`truncate failed: ${m}`);
}

const proc = Bun.spawn({
  cmd: [process.execPath, join(import.meta.dir, "real-large-s3-upload.ts")],
  env: {
    ...process.env,
    DRIME_S3_CONFIG: tomlPath,
    DRIME_S3_ENDPOINT: endpoint,
  },
  stdout: "inherit",
  stderr: "inherit",
});
const code = await proc.exited;

gw.stop();
mock.stop();
await rm(tomlPath, { force: true }).catch(() => {});
await rm(binPath, { force: true }).catch(() => {});

process.exit(code === 0 ? 0 : 1);
