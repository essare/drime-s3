#!/usr/bin/env bun
/**
 * End-to-end smoke test: talk to a **running** drime-s3 gateway with `DRIME_S3_INSECURE=1`
 * (or gateway started with `--insecure`) so no AWS Sig V4 signing is required.
 *
 * This exercises the real code path: gateway → Drime `/uploads` and `/drive/file-entries`.
 *
 * Usage:
 *   Terminal A: `export DRIME_API_KEY=…` and `DRIME_S3_INSECURE=1` then `bun run start`
 *   Terminal B: `DRIME_S3_INSECURE=1 bun run scripts/real-upload-smoke.ts http://127.0.0.1:8081`
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = (process.argv[2] ?? "http://127.0.0.1:8081").replace(/\/+$/, "");
const bucket = `real-smoke-${Date.now().toString(36)}`;
const key = "payload.bin";

const host = new URL(base).host;
const h = { Host: host };

const list = await fetch(`${base}/`, { headers: h });
if (list.status === 503) {
  throw new Error(
    "Gateway returned 503 (workspace missing or Drime misconfigured). Run: bun run src/cli/main.ts init",
  );
}
await mustOk("GET service (ListBuckets)", list);

const dir = await mkdtemp(join(tmpdir(), "drime-s3-smoke-"));
const filePath = join(dir, "data.bin");
const bytes = new Uint8Array(4096);
for (let i = 0; i < bytes.length; i++) {
  bytes[i] = i % 251;
}
await writeFile(filePath, bytes);

async function mustOk(label: string, res: Response): Promise<void> {
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${label} failed: HTTP ${res.status} ${t.slice(0, 500)}`);
  }
}

let r = await fetch(`${base}/${bucket}`, { method: "PUT", headers: h });
await mustOk(`PUT bucket ${bucket}`, r);

r = await fetch(`${base}/${bucket}/${key}`, {
  method: "PUT",
  headers: {
    ...h,
    "Content-Type": "application/octet-stream",
    "Content-Length": String(bytes.length),
  },
  body: Bun.file(filePath),
});
await mustOk(`PUT object ${key}`, r);

r = await fetch(`${base}/${bucket}/${key}`, { method: "GET", headers: h });
await mustOk(`GET object ${key}`, r);
const got = new Uint8Array(await r.arrayBuffer());
if (got.length !== bytes.length) {
  throw new Error(`size mismatch: got ${got.length}, want ${bytes.length}`);
}
for (let i = 0; i < bytes.length; i++) {
  if (got[i] !== bytes[i]) {
    throw new Error(`byte mismatch at ${i}`);
  }
}

r = await fetch(`${base}/${bucket}/${key}`, { method: "HEAD", headers: h });
await mustOk(`HEAD object ${key}`, r);
const cl = r.headers.get("content-length");
if (cl !== String(bytes.length)) {
  throw new Error(`HEAD Content-Length: got ${cl}, want ${bytes.length}`);
}

console.log(
  `OK — created bucket ${bucket}, uploaded ${bytes.length} bytes, verified GET/HEAD.`,
);
await rm(dir, { recursive: true, force: true }).catch(() => {});
