#!/usr/bin/env bun
/**
 * Minimal S3 multipart sequence against a **running** drime-s3 gateway: initiate → one part →
 * complete → GET (no large file; same code path as multi-part / big uploads).
 *
 * Uses plain `fetch` like `real-upload-smoke.ts`, so the gateway must accept unsigned requests
 * (e.g. `DRIME_S3_INSECURE=1` / `--insecure`). Sig V4 is not implemented in this script.
 *
 * Usage:
 *   Terminal A: `export DRIME_API_KEY=…` and `DRIME_S3_INSECURE=1` then `bun run start`
 *   Terminal B: `DRIME_S3_INSECURE=1 bun run scripts/multipart-smoke.ts http://127.0.0.1:8081`
 *
 * Optional args: `[baseUrl] [bucket] [key]` — default bucket is `mp-smoke-<time>`, key `small.bin`.
 */
import { XMLParser } from "fast-xml-parser";

const base = (process.argv[2] ?? "http://127.0.0.1:8081").replace(/\/+$/, "");
const bucket = process.argv[3] ?? `mp-smoke-${Date.now().toString(36)}`;
const key = process.argv[4] ?? "small.bin";

const host = new URL(base).host;
const h = { Host: host };

const partBytes = new TextEncoder().encode(
  "multipart-smoke payload (any size; one part is enough).\n",
);

const xmlParser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

async function mustOk(label: string, res: Response): Promise<void> {
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${label} failed: HTTP ${res.status} ${t.slice(0, 800)}`);
  }
}

function parseUploadIdFromInitiateXml(xml: string): string {
  const doc = xmlParser.parse(xml) as Record<string, unknown>;
  const root =
    doc.InitiateMultipartUploadResult ?? doc.initiateMultipartUploadResult;
  if (!root || typeof root !== "object") {
    throw new Error("Initiate response: missing InitiateMultipartUploadResult");
  }
  const id = (root as Record<string, unknown>).UploadId;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Initiate response: missing UploadId");
  }
  return id;
}

const list = await fetch(`${base}/`, { headers: h });
if (list.status === 503) {
  throw new Error(
    "Gateway returned 503 (workspace missing). Run: bun run src/cli/main.ts init",
  );
}
await mustOk("GET / (ListBuckets)", list);

let r = await fetch(`${base}/${bucket}`, { method: "PUT", headers: h });
await mustOk(`PUT bucket ${bucket}`, r);

r = await fetch(`${base}/${bucket}/${key}?uploads=`, {
  method: "POST",
  headers: h,
});
await mustOk(`POST initiate multipart ${key}`, r);
const initXml = await r.text();
const uploadId = parseUploadIdFromInitiateXml(initXml);

const q = new URLSearchParams({
  partNumber: "1",
  uploadId,
});
r = await fetch(`${base}/${bucket}/${key}?${q.toString()}`, {
  method: "PUT",
  headers: {
    ...h,
    "Content-Type": "application/octet-stream",
    "Content-Length": String(partBytes.length),
  },
  body: partBytes,
});
await mustOk("PUT part 1", r);
const etagHeader = r.headers.get("etag");
const etagInner = etagHeader?.replace(/^"+|"+$/g, "") ?? "";

const completeBody = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Part>
    <PartNumber>1</PartNumber>
    <ETag>"${etagInner}"</ETag>
  </Part>
</CompleteMultipartUpload>`;

const cq = new URLSearchParams({ uploadId });
r = await fetch(`${base}/${bucket}/${key}?${cq.toString()}`, {
  method: "POST",
  headers: {
    ...h,
    "Content-Type": "application/xml",
    "Content-Length": String(Buffer.byteLength(completeBody, "utf8")),
  },
  body: completeBody,
});
await mustOk("POST complete multipart", r);

r = await fetch(`${base}/${bucket}/${key}`, { method: "GET", headers: h });
await mustOk(`GET object ${key}`, r);
const got = new Uint8Array(await r.arrayBuffer());
if (got.length !== partBytes.length) {
  throw new Error(`GET size: want ${partBytes.length}, got ${got.length}`);
}
for (let i = 0; i < got.length; i++) {
  if (got[i] !== partBytes[i]) {
    throw new Error(`byte mismatch at ${i}`);
  }
}

await fetch(`${base}/${bucket}/${key}`, { method: "DELETE", headers: h });
await fetch(`${base}/${bucket}`, { method: "DELETE", headers: h });

console.log(
  `OK — multipart upload (${partBytes.length} bytes), verified GET, cleaned up bucket ${bucket}.`,
);
