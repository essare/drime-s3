#!/usr/bin/env bun
/**
 * Production-style **large object** upload using the **AWS CLI** `aws s3 cp`, which performs
 * multipart uploads above its threshold (typically 8 MiB on AWS CLI v1/v2). This matches how
 * rclone/Duplicati-style tools stress the gateway with real S3 signing.
 *
 * **Requires** `aws` on `PATH`, a **running** drime-s3 gateway, and **S3 credentials that match
 * the gateway** (same `config.toml` as `serve`, or `S3_ACCESS_KEY` / `S3_SECRET_KEY` in the environment).
 *
 * **Default local file**: `scripts/bin/payload.bin` (see `scripts/bin/README.md`).
 *
 * Usage:
 *   # optional: DRIME_S3_ENDPOINT=https://your-host:443 (else http://[server.host]:[server.port] from config)
 *   bun run scripts/real-large-s3-upload.ts [local-file] [bucket] [s3-key]
 *
 * Examples:
 *   bun run scripts/real-large-s3-upload.ts
 *   bun run scripts/real-large-s3-upload.ts ./scripts/bin/my.iso my-bucket backups/my.iso
 *
 * Env:
 *   DRIME_S3_CONFIG          — path to config TOML (default: ~/.config/drime-s3/config.toml)
 *   DRIME_S3_ENDPOINT        — full gateway base URL, e.g. https://s3.example.com:443
 *   DRIME_S3_LARGE_UPLOAD_NO_CLEANUP=1 — keep bucket/object after success
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ConfigError, loadConfig, resolveConfigPath } from "../src/config";

const configPath =
  process.env.DRIME_S3_CONFIG !== undefined &&
  process.env.DRIME_S3_CONFIG.trim() !== ""
    ? process.env.DRIME_S3_CONFIG.trim()
    : undefined;

const cfg = await loadConfig({ configPath }).catch((e) => {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
});

const endpointRaw =
  process.env.DRIME_S3_ENDPOINT?.trim().replace(/\/+$/, "") ??
  `http://${cfg.server.host}:${cfg.server.port}`;
const endpoint = endpointRaw;

const argvFile = process.argv[2];
const argvBucket = process.argv[3];
const argvKey = process.argv[4];

const defaultBinFile = join(import.meta.dir, "bin", "payload.bin");
const localFile = argvFile ? resolve(process.cwd(), argvFile) : defaultBinFile;

const f = Bun.file(localFile);
if (!(await f.exists())) {
  console.error(
    `Missing file: ${localFile}\n` +
      `Place a large binary at scripts/bin/payload.bin or pass an explicit path.\n` +
      `See scripts/bin/README.md`,
  );
  process.exit(1);
}

const size = f.size;
if (size <= 0) {
  console.error(`Refusing empty file: ${localFile}`);
  process.exit(1);
}

const bucket = argvBucket ?? `prod-large-${Date.now().toString(36)}`;
const key = argvKey ?? basename(localFile);

const noCleanup =
  process.env.DRIME_S3_LARGE_UPLOAD_NO_CLEANUP === "1" ||
  process.env.DRIME_S3_LARGE_UPLOAD_NO_CLEANUP === "true";

function awsEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: cfg.s3.accessKey,
    AWS_SECRET_ACCESS_KEY: cfg.s3.secretKey,
    AWS_DEFAULT_REGION: cfg.s3.region,
    AWS_EC2_METADATA_DISABLED: "true",
  };
}

async function runAws(args: string[], label: string): Promise<void> {
  const proc = Bun.spawn(["aws", ...args], {
    env: awsEnv(),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${label} failed (exit ${code}): aws ${args.join(" ")}`);
  }
}

async function sha256Hex(path: string): Promise<string> {
  const hash = createHash("sha256");
  const file = Bun.file(path);
  const reader = file.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined && value.byteLength > 0) {
      hash.update(value);
    }
  }
  return hash.digest("hex");
}

const which = Bun.spawnSync({ cmd: ["command", "-v", "aws"], stderr: "pipe" });
if (which.exitCode !== 0) {
  console.error(
    "AWS CLI not found. Install aws-cli and ensure `aws` is on PATH.\n" +
      "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
  );
  process.exit(1);
}

console.log(`Config: ${resolveConfigPath(configPath)}`);
console.log(`Endpoint: ${endpoint}`);
console.log(`Upload: ${localFile} (${size} bytes) → s3://${bucket}/${key}`);
console.log(`Region: ${cfg.s3.region}`);

try {
  await runAws(
    [
      "s3",
      "mb",
      `s3://${bucket}`,
      "--endpoint-url",
      endpoint,
      "--region",
      cfg.s3.region,
    ],
    "create bucket",
  );
} catch {
  console.warn(
    "Note: s3 mb failed (bucket may already exist). Continuing with upload.",
  );
}

await runAws(
  [
    "s3",
    "cp",
    localFile,
    `s3://${bucket}/${key}`,
    "--endpoint-url",
    endpoint,
    "--region",
    cfg.s3.region,
  ],
  "s3 cp (multipart when over CLI threshold)",
);

const tmpDir = await mkdtemp(join(tmpdir(), "drime-s3-large-verify-"));
const downloaded = join(tmpDir, "downloaded.bin");
try {
  await runAws(
    [
      "s3",
      "cp",
      `s3://${bucket}/${key}`,
      downloaded,
      "--endpoint-url",
      endpoint,
      "--region",
      cfg.s3.region,
    ],
    "s3 cp download for verification",
  );

  const [a, b] = await Promise.all([
    sha256Hex(localFile),
    sha256Hex(downloaded),
  ]);
  if (a !== b) {
    throw new Error(
      `SHA-256 mismatch after round-trip: source ${a} vs downloaded ${b}`,
    );
  }
  console.log(`SHA-256 OK (${a.slice(0, 16)}…)`);
} finally {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}

if (!noCleanup) {
  await runAws(
    [
      "s3",
      "rm",
      `s3://${bucket}/${key}`,
      "--endpoint-url",
      endpoint,
      "--region",
      cfg.s3.region,
    ],
    "delete object",
  );
  await runAws(
    [
      "s3",
      "rb",
      `s3://${bucket}`,
      "--endpoint-url",
      endpoint,
      "--region",
      cfg.s3.region,
    ],
    "delete bucket",
  );
}

console.log(
  noCleanup
    ? `OK — uploaded and verified; left s3://${bucket}/${key} (DRIME_S3_LARGE_UPLOAD_NO_CLEANUP).`
    : `OK — multipart-style upload, verified SHA-256, removed s3://${bucket}/${key}.`,
);
