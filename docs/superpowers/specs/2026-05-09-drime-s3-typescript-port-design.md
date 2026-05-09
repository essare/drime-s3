# Drime S3 — TypeScript Port & Bucket Management Design

**Date:** 2026-05-09  
**Revision:** 2026-05-10 — bucket mapping changed from `/.s3/` root folder to a **dedicated Drime workspace** (see §3, §5).

**Status:** Approved (brainstorming complete; ready for implementation planning)
**Author:** Brainstorming session output

---

## 1. Goal

Port the existing Python `drime-s3` gateway (`python-port/`) to TypeScript on Bun, while adding real bucket management (Create/Delete/Head/List buckets) and the broader S3 surface that modern SDKs expect (ListObjectsV2, batch DeleteObjects, ListMultipartUploads, user-defined metadata, presigned URL verification, CORS, tagging stubs). The result is a single-process, self-hosted, AWS-S3-compatible HTTP gateway that translates S3 calls to Drime Cloud's HTTP API.

## 2. Non-Goals

- **Versioning, ACLs, bucket policies, lifecycle rules, replication, Object Lock, KMS / SSE-C.** No analog in Drime; out of scope.
- **Multi-tenant credential model.** One `DRIME_API_KEY` per process; multi-credential is a v1.1 consideration.
- **Migration tooling from the Python version.** Fresh-start project; users with existing Python deployments handle their own data move.
- **Server-supplied presigned URL generation endpoints.** Clients use any standard SDK to mint presigned URLs against the configured shared secret; the gateway only verifies them.
- **Persistent multipart session recovery.** In-memory only, lost on restart (matches Python).
- **Telemetry / Sentry / Prometheus.** v1.1 if requested.

## 3. High-level Decisions (Locked In)

| # | Decision | Choice |
|---|---|---|
| 1 | Bucket-to-Drime mapping | **Dedicated workspace:** the gateway uses one Drime workspace (default name `drime-s3`). **Each top-level folder in that workspace’s root is one S3 bucket.** Object keys live under that folder tree. All drive calls use that workspace’s `workspaceId` (not `0`). |
| 2 | Runtime + HTTP layer | **Bun + `Bun.serve`** (native TS, web-standard streams, single-binary `bun build --compile`) |
| 3 | Feature scope | **Tier 0 + 1 + 2 + 3** — port parity + bucket mgmt + modern-SDK essentials + presigned URLs / CORS / tagging stubs |
| 4 | S3 client authentication | **Single validated credential** (Sig V4 verified) with `--insecure` opt-out flag for trust-mode |
| 5 | State persistence | **Fully stateless gateway** — all metadata in Drime entry `description` (versioned JSON), in-memory caches only |
| 6 | Repo layout | **Single TS project at repo root**; `python-port/` left untouched alongside |
| 7 | Workspace bootstrap | **`drime-s3 init`:** `GET /me/workspaces` — if no workspace named `gatewayWorkspaceName` (default `drime-s3`), **`POST /workspace`** with body `{"name":"drime-s3"}` (same `Authorization: Bearer` API key). **Never auto-create on `serve` startup** (avoids masking misconfiguration); if workspace is missing at runtime, return **503** with message to run `init`. Optional config **`gateway_workspace_id`** pins the id and skips discovery. |

## 4. Architecture

### 4.1 Module Layout

```
src/
├── server.ts              # Bun.serve entrypoint + routing dispatch
├── config.ts              # env + ~/.config/drime-s3/config.toml loader
├── auth/
│   ├── sigv4.ts           # AWS Sig V4 verification (header + presigned)
│   ├── chunked-decoder.ts # STREAMING-AWS4-HMAC-SHA256-PAYLOAD body decoder
│   └── presigned.ts       # presigned URL verification
├── drime/
│   ├── client.ts          # DrimeClient (fetch-based, retry+backoff)
│   ├── workspace.ts       # Parse /me/workspaces + POST /workspace responses
│   ├── types.ts           # FileEntry, ListResponse, MultipartInit, etc.
│   └── metadata.ts        # description-blob encode/decode
├── s3/
│   ├── router.ts          # method+path+query → handler dispatch
│   ├── errors.ts          # S3 XML error responses
│   ├── xml.ts             # XML build/parse (fast-xml-parser)
│   ├── naming.ts          # bucket name validation, key sanitization
│   └── handlers/
│       ├── service.ts     # ListBuckets
│       ├── bucket.ts      # CreateBucket, DeleteBucket, HeadBucket, ListObjectsV1+V2, ListMultipartUploads
│       ├── object.ts      # GetObject, PutObject, DeleteObject, HeadObject, CopyObject
│       ├── batch.ts       # DeleteObjects (batch)
│       ├── multipart.ts   # Initiate/UploadPart/Complete/Abort/ListParts
│       ├── tagging.ts     # GetObjectTagging, PutObjectTagging
│       └── cors.ts        # OPTIONS preflight
├── cache/
│   ├── folder-paths.ts    # path → folderId, permanent in-memory
│   └── list-ttl.ts        # folderId → entries, 5s TTL with single-flight lock
├── multipart/
│   └── session-store.ts   # in-memory: uploadId → {key, parts, sizes, md5s}
├── cli/
│   ├── main.ts            # CLI: serve | init | print-config
│   └── init.ts            # ensures gateway workspace (+ keypair generation elsewhere)
└── util/
    ├── logger.ts          # pino-based structured logger
    └── streams.ts         # ReadableStream helpers (md5 tee, length tracker)
```

### 4.2 Bootstrap Sequence

```
parse argv + env
  → load ~/.config/drime-s3/config.toml (auto-generate keypair on first run)
  → instantiate DrimeClient(api_key)
  → instantiate caches (FolderPathCache, ListTtlCache, MultipartSessionStore)
  → resolve **gateway `workspaceId`** (from config pin, else `GET /me/workspaces` by name; if missing → **503** “run drime-s3 init” — do not auto-create here)
  → wire handlers with dependencies (all list/upload/folder ops pass this `workspaceId`)
  → Bun.serve({ host, port, fetch: router.dispatch })
```

### 4.3 External Dependencies (Tight Allowlist)

| Dependency | Purpose |
|---|---|
| `pino` | structured JSON logging |
| `fast-xml-parser` | S3 XML build/parse |
| `smol-toml` | config file parsing |
| Bun built-ins | `crypto.subtle`, `Bun.write`, `Bun.file`, `Bun.serve`, `fetch`, `bun:test` |

No web framework, no AWS SDK, no node:http shims.

## 5. Bucket Model (dedicated workspace)

### 5.1 Workspace APIs (Drime Cloud)

- **List workspaces:** `GET {apiBaseUrl}/me/workspaces` with `Authorization: Bearer <DRIME_API_KEY>`. (Example: [`GET /api/v1/me/workspaces`](https://app.drime.cloud/api/v1/me/workspaces).)
- **Create workspace:** `POST {apiBaseUrl}/workspace` with JSON body `{"name":"<gatewayWorkspaceName>"}` (default name `drime-s3`), same bearer token. (Example: [`POST /api/v1/workspace`](https://app.drime.cloud/api/v1/workspace) with body `{"name":"drime-s3"}`.)

Response JSON shapes are normalized in code (support common `{ data: [...] }` or bare array patterns); each workspace must expose at least `id` (number) and `name` (string).

### 5.2 Storage layout (logical)

```
Workspace "drime-s3" (workspaceId = W)
├── my-bucket/          ← S3 bucket "my-bucket" (folder at workspace root)
│   ├── photos/
│   │   └── img.png     ← S3 key "photos/img.png" inside bucket my-bucket
│   └── docs/
└── another-bucket/     ← S3 bucket "another-bucket"
```

- **ListBuckets:** `GET /drive/file-entries?workspaceId=W` with **no** `parentIds` (or equivalent “root of this workspace” per Drime API), filter entries to **`type === folder`** and **S3-valid bucket names** (skip invalid names created in the Drime UI).
- **CreateBucket:** `POST /folders` with `{ name, workspaceId: W }` and **no** `parentId` (root of that workspace). 409 if a root folder with that name already exists.
- **All object/list/upload/delete paths** use `workspaceId=W` on `/drive/file-entries`, `/folders`, `/uploads`, etc. (replacing the old hardcoded `workspaceId: 0` from the Python port).

**Runtime resolution:** On `serve`, resolve `W` once: if `gateway_workspace_id` in config → use it; else `GET /me/workspaces` and find `name === gatewayWorkspaceName`. If not found → **503** `ServiceUnavailable`, body instructing `drime-s3 init` (do **not** auto-create workspace on serve).

**`drime-s3 init`:** `GET /me/workspaces` → if workspace named `gatewayWorkspaceName` missing → `POST /workspace` with `{"name":...}`. Idempotent if workspace already exists.

### 5.3 Bucket name validation

Same rules as before (S3 DNS-style bucket names). Enforced at `CreateBucket` and defensively when listing buckets (skip invalid root folder names).

### 5.4 Bucket operations (summary)

| Op | HTTP | Drime calls | Notes |
|---|---|---|---|
| ListBuckets | `GET /` | `GET /drive/file-entries?workspaceId=W` (root), folders only, filter valid names | |
| CreateBucket | `PUT /<bucket>` | `POST /folders` `{ name, workspaceId: W }` at root | 409 if exists |
| DeleteBucket | `DELETE /<bucket>` | list root children / folder empty check → `POST /file-entries/delete` | 409 if not empty |
| HeadBucket | `HEAD /<bucket>` | resolve root folder by name | 200 / 404 |
| GetBucketLocation / Versioning / Acl | stubs | unchanged | |

`LocationConstraint` in CreateBucket body remains ignored.

## 6. Authentication

### 6.1 Configuration

`~/.config/drime-s3/config.toml` (auto-generated on first run with random keypair):

```toml
[s3]
access_key = "DRIMES3..."
secret_key = "..."
region     = "drime"

[drime]
api_key = "${DRIME_API_KEY}"
# Dedicated workspace: root folders = S3 buckets (default name "drime-s3")
gateway_workspace_name = "drime-s3"
# gateway_workspace_id = 42   # optional: skip discovery if set

[server]
host = "127.0.0.1"
port = 8081
```

**Env-var overrides:** `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `DRIME_API_KEY`, `DRIME_GATEWAY_WORKSPACE_NAME`, `DRIME_GATEWAY_WORKSPACE_ID` (integer pin), `DRIME_S3_HOST`, `DRIME_S3_PORT`, `DRIME_S3_INSECURE=1`.

**`region` is informational only.** AWS Sig V4 carries the region in the credential scope (`<accessKey>/<date>/<region>/s3/aws4_request`); we extract whatever the client signed with and use that to derive the signing key. Our config `region` field exists only for documentation/AWS CLI guidance and is not validated against incoming requests. Clients can use any region string (`drime`, `us-east-1`, `auto`) and it will work as long as their signature is correct against that scope.

### 6.2 Sig V4 Verification

Standard AWS Sig V4 algorithm. Implementation in `auth/sigv4.ts`, ~250 LOC, no dependencies (uses Bun's `crypto.subtle`). Verified against AWS-published test vectors in unit tests.

- **Header form:** parse `Authorization`, build canonical request, derive signing key, constant-time compare signature.
- **Presigned URL form:** same algorithm, signature carried in `X-Amz-Signature` query param. Also verifies `X-Amz-Date + X-Amz-Expires` window.
- **Chunked Sig V4 body** (`x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD`): `auth/chunked-decoder.ts` is a `TransformStream` that strips chunk framing (`<hex-size>;chunk-signature=<sig>\r\n<bytes>\r\n`), verifies per-chunk signatures, emits raw bytes downstream.

### 6.3 `--insecure` Mode

When `DRIME_S3_INSECURE=1` or `--insecure` flag:

- Header Sig V4: skip signature verification (still parse to extract access key for logging).
- Chunked Sig V4: still decode chunks (need the raw bytes), skip per-chunk signature verification.
- Presigned URLs: skip signature verification, still check expiry window if present.
- Print stark startup warning.
- **Refuse to start if `--insecure` AND host is non-localhost** unless `--i-know-what-im-doing` is also passed.

### 6.4 Out of Scope

- IAM, STS, AssumeRole, SSO
- IAM-style bucket policies
- Per-bucket ACL enforcement (operations succeed; ACLs are stubs)

## 7. Metadata Model

### 7.1 Schema

Drime entry `description` field stores a versioned JSON blob:

```json
{
  "v": 1,
  "md5": "d41d8cd98f00b204e9800998ecf8427e",
  "ct":  "image/png",
  "meta": { "author": "alice", "project": "q4" },
  "tags": { "env": "prod", "owner": "team-a" }
}
```

All fields except `v` optional. Empty objects omitted. Typical size 100–300 bytes; worst case ~3.5 KB (S3 max metadata + 10 tags).

### 7.2 Decode Rules (`drime/metadata.ts`)

```ts
function readMetadata(description: string | null): Metadata {
  if (!description) return {};
  if (description.startsWith("md5:")) {                 // Python legacy
    return { md5: description.slice(4) };
  }
  try {
    const parsed = JSON.parse(description);
    if (parsed && typeof parsed === "object" && parsed.v === 1) {
      return parsed;
    }
  } catch { /* fall through */ }
  return { description };                                // Drime UI free-form description
}
```

### 7.3 Write Rules

- On any metadata-writing operation, read current description first.
- If shape was `{description: "..."}` (Drime UI free-form), **never overwrite**; log warning, skip persist.
- Otherwise, merge new fields into existing object, encode as JSON, `PUT /file-entries/{id}`.

This protects user-set descriptions from silent destruction by S3 ops.

### 7.4 ETag Computation

- **Single PUT:** `ETag = md5(body)`. Computed in-flight via `Md5Tee` TransformStream.
- **Multipart:** `ETag = md5(concat(part_md5_bin)) + "-" + N`. Per-part MD5s tracked in session store. Standard S3 multipart ETag format.
- **List read path:** prefer JSON `md5` → legacy `md5:` → Drime entry `hash` → literal `"unknown"`.

### 7.5 Open Question (Resolved at Implementation Time)

**Drime `description` field length limit unknown.** Probe in implementation by writing a 64KB description; if rejected, evaluate fallback (e.g. truncate `meta`/`tags` with explicit error, or use a side-car file with a sentinel marker). Add as a probe task in the plan, not a blocker for this design.

## 8. Request Lifecycle (Hot Paths)

### 8.1 GET object (download)

```
verify Sig V4 → resolve bucket → resolve key → fetch download URL from Drime
  → fetch(url, {redirect: "follow", headers: {Range, Authorization}})
  → propagate status (200/206), Content-Length, Content-Range, Content-Type, ETag, Last-Modified, Accept-Ranges, x-amz-meta-*
  → pipe upstream ReadableStream → Response body (zero buffering)
```

### 8.2 PUT object (default — spool to disk)

```
verify Sig V4 → optional dispatch to copyObject (if x-amz-copy-source)
  → ensure parent folder (race-safe; port Python 422 retry logic)
  → collect x-amz-meta-*, x-amz-tagging, content-type → metadata blob
  → request.body
       → ChunkedSigV4Decoder (if needed)
       → Md5Tee
       → Bun.write(tempFile)
  → if existing key in folder: delete it (S3 PUT replaces)
  → DrimeClient.upload(tempFile, filename, parentId)
  → write metadata blob to entry description
  → unlink tempFile
  → 200 with ETag header
```

**Why temp file:** Drime `/uploads` uses `multipart/form-data` requiring `Content-Length`; chunked Sig V4 doesn't carry that up front. `--streaming-uploads` flag (opt-in) promotes large single-PUTs above 5 MB to internal multipart uploads via `s3/multipart/*`, eliminating the disk spool.

### 8.3 PUT object (multipart)

S3 client → gateway → Drime `s3/multipart/*` → R2 signed URLs (matches Python).

```
POST /<bucket>/<key>?uploads
  → DrimeClient POST /s3/multipart/create
  → composite UploadId = "v1." + base64url({uid, key})
  → register in session-store

PUT /<bucket>/<key>?partNumber=N&uploadId=...
  → DrimeClient POST /s3/multipart/batch-sign-part-urls
  → fetch().PUT signed R2 URL, body = request.body (streaming)
  → record part {size, md5, etag} in session-store
  → return ETag from R2

POST /<bucket>/<key>?uploadId=...
  → parse XML CompleteMultipartUpload body
  → DrimeClient POST /s3/multipart/complete
  → DrimeClient POST /s3/entries (register file)
  → write metadata blob to entry description
  → cleanup session-store
  → return CompleteMultipartUploadResult XML

DELETE /<bucket>/<key>?uploadId=...
  → DrimeClient POST /s3/multipart/abort
  → cleanup session-store
  → return 204
```

**UploadId encoding versioned** (`v1.` prefix); legacy decoder handles unprefixed Python composites for forward-compat.

### 8.4 ListObjectsV2

S3 V2 pagination with continuation tokens. Continuation token = base64-encoded "last key seen" string; on receipt, decode and skip keys lexicographically less-than-or-equal to it (i.e., behaves as `start-after`). Token is opaque to the client. Drime's internal pagination is unwrapped, then we re-paginate at the S3 layer. `delimiter=/` → single-level (`Contents` + `CommonPrefixes`); no delimiter → recursive (full subtree, supports `restic` and similar tools). `MaxKeys` defaults to 1000, capped at 10000.

### 8.5 DeleteObjects (batch)

```
POST /<bucket>?delete
  → parse <Delete><Object><Key>...</Key></Object>...</Delete>
  → resolve all keys to entry IDs in parallel
  → DrimeClient POST /file-entries/delete with all IDs
  → return <DeleteResult> with per-key Deleted/Error entries
```

Replaces N round-trips with one for `aws s3 rm --recursive` and SDK cleanup.

## 9. Streaming, Range, Memory Bounds

- **Streams:** Web-standard `ReadableStream` everywhere. No `Buffer.concat` on bodies.
- **MD5:** computed in-flight via `Md5Tee` TransformStream that hashes incrementally and forwards bytes.
- **Range:** propagate inbound, propagate 206 + Content-Range outbound. Multi-range requests rejected with 416 (no client uses them).
- **HEAD with Range:** AWS-compliant 206 + Content-Range, no body.
- **`--streaming-uploads`:** opt-in flag. Single PUTs > 5 MB with known Content-Length are promoted to internal multipart, streamed directly to R2 in 10 MB parts. Bounded memory ~20–30 MB regardless of file size.
- **Concurrency:** no inbound cap; Drime outbound capped at 50 in-flight (configurable via `DRIME_S3_DRIME_CONCURRENCY`); R2 outbound uncapped.
- **Reject:** `Transfer-Encoding: chunked` on PUT (when not chunked Sig V4) → 411 Length Required.

## 10. Caching

### 10.1 Folder Path Cache (`cache/folder-paths.ts`)

- `Map<lowercased_path, folder_id>`, permanent for process lifetime. Paths are **logical S3 paths inside a bucket** (e.g. `photos/img` within bucket `my-bucket`), or include bucket prefix as `my-bucket/photos/img` — pick one convention and use it consistently in handlers; keys must be scoped to the **gateway workspace** (workspace id `W` is not stored in the map; all list calls use `W` from context).
- Populated incrementally on every successful folder resolution under that workspace.
- Eviction triggers: **DeleteBucket** (evict all keys with that bucket prefix), **DeleteObject** of a folder subtree (evict by prefix). No TTL.
- Folder rename via Drime UI is undetectable; documented limitation, requires gateway restart.

### 10.2 List TTL Cache (`cache/list-ttl.ts`)

- `Map<folder_id, {ts, entries}>`, 5-second TTL.
- **Single-flight:** concurrent requests for the same cold key share one in-flight Drime call (prevents cache stampede).
- Invalidation on every write (create/delete/rename in folder).
- Soft cap 100 MB; LRU evict by `ts`.

### 10.3 Multipart Session Store

- In-memory `Map<drime_uid, MultipartSession>`.
- Bounded: max 10k active sessions; oldest evicted with warning log if exceeded.
- TTL sweep every 60s; sessions older than 24h evicted.
- Lost on restart (documented).

### 10.4 Observability

Optional `/_health` endpoint (gated to localhost):

```json
{
  "status": "ok",
  "uptime": 12345,
  "caches": {
    "folder_paths": { "size": 47 },
    "list_ttl":     { "size": 12, "fresh": 8, "stale": 4 },
    "multipart":    { "sessions": 3 }
  }
}
```

## 11. Errors & Retry

### 11.1 Drime → S3 Error Mapping

| Drime status | S3 mapping | Retryable |
|---|---|---|
| 401 (gateway's `DRIME_API_KEY` invalid) | `ServiceUnavailable` (503), `Retry-After: 60`, log error with `gateway_misconfigured: true` | No |
| 403 | `AccessDenied` (403) | No |
| 404 (DELETE) | success (204) | No |
| 404 (other) | `NoSuchKey` (404) | No |
| 422 (race "already exists") | `BucketAlreadyOwnedByYou` (409) | No |
| 422 (other) | `InvalidRequest` (400) | No |
| 429 | `SlowDown` (503), Retry-After: 5 | Yes |
| 502/503/504 | `ServiceUnavailable` (503), Retry-After: 5 | Yes |
| Other 5xx | `InternalError` (502) | Yes |
| Network error | `InternalError` (500) | Yes |

Note on 401: returning `InvalidAccessKeyId` here would mislead the user into thinking *their* S3 keypair is wrong, when in fact the gateway's own Drime token has expired/been revoked. `ServiceUnavailable` plus a clear gateway-side log message is the honest mapping.

### 11.2 Retry Strategy (`drime/client.ts`)

- 5 attempts max.
- Exponential backoff `500ms × attempt` (~7.5s worst case).
- Retry on: network errors, 429, 502/503/504.
- **Never retry:** 4xx (except 429), client-aborted, `POST /uploads` (non-idempotent — fail fast, let S3 client retry full PUT).
- Multipart endpoints: **safely retryable in practice**, with one nuance.
  - `UploadPart` / `Complete` / `Abort`: keyed by `(key, uploadId)`; retrying with the same args is benign on Drime + R2 side.
  - `Init` (`POST /s3/multipart/create`): not strictly idempotent — a retry creates a new `uploadId`. Worst case is an orphaned upload session in Drime, which is swept by Drime's own multipart TTL (and our 24h session-store TTL prevents the gateway-side leak). Acceptable.

### 11.3 Stream Error Handling

| Failure | Action |
|---|---|
| Client disconnected mid-PUT | abort temp write, unlink, log warning |
| Drime upload fails mid-stream | 500 to client, no partial commit |
| Upstream Drime/R2 disconnect mid-GET | propagate stream error; client SDK retries with Range |

## 12. Observability

- **Logger:** `pino` JSON to stdout. Per-request log fields: `req_id` (UUID), `method`, `path`, `query` (sanitized), `bucket`, `key`, `status`, `duration_ms`, `bytes_in`, `bytes_out`, `drime_calls`, `error.code`, `error.message`. **No bodies logged.**
- **Levels:** `info` (request summary), `debug` (cache hits/misses, Drime calls), `warn` (retries, rate limits, race resolutions), `error` (5xx, unhandled).
- **Default:** `info`. `--debug` flips to `debug`.
- **Request ID:** UUID v4, set as `x-amz-request-id` response header (AWS standard).
- **Metrics:** not in v1.

## 13. Process Lifecycle

- **Startup:** load config → validate (refuse `--insecure` + non-localhost without `--i-know-what-im-doing`) → resolve **gateway workspace id `W`** (see §5) → log `ready on http://host:port` → `Bun.serve`.
- **Graceful shutdown:** SIGTERM/SIGINT → stop accepting → drain in-flight up to 30s → log any orphaned multipart sessions → exit. Configurable via `--shutdown-timeout`.
- **Crash recovery:** OS-level (systemd `Restart=on-failure` or `docker --restart unless-stopped`). No app-level supervision.

## 14. Testing

### 14.1 Pyramid

```
tests/
├── unit/         (~70%, no I/O, pure logic)
│   ├── auth/sigv4.test.ts          (AWS test vectors)
│   ├── auth/chunked-decoder.test.ts
│   ├── auth/presigned.test.ts
│   ├── s3/naming.test.ts
│   ├── s3/xml.test.ts
│   ├── s3/errors.test.ts
│   ├── drime/metadata.test.ts      (legacy compat, free-form preserve)
│   ├── drime/client.test.ts        (retry/backoff with mocked fetch)
│   └── cache/list-ttl.test.ts      (single-flight, TTL)
├── integration/  (~25%, real Bun.serve + MockDrimeServer)
│   ├── put-get-roundtrip.test.ts
│   ├── multipart.test.ts
│   ├── chunked-upload.test.ts
│   ├── range-request.test.ts
│   ├── delete-objects-batch.test.ts
│   └── list-objects-v2-pagination.test.ts
└── e2e/          (~5%, real Drime account, gated by env var)
    ├── aws-cli-compat.test.ts      (port of python-port/test_s3.sh)
    ├── boto3-compat.test.ts
    └── rclone-compat.test.ts
```

### 14.2 MockDrimeServer

`tests/fixtures/mock-drime/` — pure Bun.serve handler implementing the Drime endpoints we use, with the same response shapes as production. Lets integration tests run hermetically in CI.

### 14.3 Coverage Targets

- Unit: 90%+
- Integration: every S3 op + every non-trivial error path
- E2E: confidence-only, no gate

## 15. Build & Distribution

### 15.1 Outputs (One Source Tree)

| Format | How | Audience |
|---|---|---|
| **NPM package** `drime-s3` | `bun publish` | Bun/Node users; `bun install -g drime-s3` |
| **Single binary** `drime-s3-{platform}` | `bun build --compile --target=...` | Non-Bun users; attached to GitHub release |
| **Docker image** `drime-s3:vX.Y.Z` | `oven/bun:slim` base, multi-arch via buildx | Orchestrated deployments |

### 15.2 Tooling

- `bun build` (compile/bundle, no webpack/esbuild)
- `tsc --noEmit` (type checking; Bun runs TS but doesn't typecheck)
- `biome` (lint + format, single config)
- `lefthook` (pre-commit hook)

### 15.3 CI (GitHub Actions)

PR + push to main:
1. Setup Bun
2. `bun install --frozen-lockfile`
3. `bun run typecheck`
4. `bun run lint`
5. `bun test` (unit + integration)

Tag release:
1. All of the above
2. `bun build --compile` for 4 targets
3. Upload to GitHub Release
4. `bun publish` (npm)
5. `docker buildx` multi-arch push to Docker Hub + GHCR

## 16. Repo Layout

```
/                                 # repo root
├── package.json                  # single project, no workspaces
├── bun.lockb
├── tsconfig.json
├── biome.json
├── Dockerfile
├── .github/workflows/{ci,release}.yml
├── README.md
├── CHANGELOG.md
├── docs/superpowers/specs/       # this design doc lives here
├── src/                          # (per §4.1)
├── tests/                        # (per §14.1)
├── python-port/                  # untouched
├── drime-swagger.yaml            # untouched
└── .env                          # untouched
```

## 17. Open Questions / Implementation Probes

These are not blockers for the design but must be resolved during implementation. Captured here so the implementation plan addresses them explicitly.

1. **Drime `description` field length limit.** Probe with 64 KB write. Determines whether metadata blob has hard size cap.
2. **Drime `/uploads` behavior on duplicate filename in same parent.** Does it overwrite, error, or auto-rename? Affects whether the explicit "delete existing then upload" pattern is needed (Python does this; verify it's still required).
3. **Drime API rate-limit thresholds.** Default 50 in-flight may be too high or too low. Tune from real-traffic logs in beta.
4. **`x-amz-request-id` format.** AWS uses 16-byte hex; SDKs don't validate format. UUID v4 is fine but flag for confirmation.
5. **Bun's chunked fetch streaming for outbound.** Verify with a manual test that `fetch(url, {body: ReadableStream})` doesn't internally buffer for `multipart/form-data` payloads.

## 18. v1.1 Backlog (Out of Scope, Captured for Memory)

- Multi-credential auth with per-bucket access (Option C from brainstorming)
- Persistent multipart session store (SQLite)
- Prometheus `/metrics` endpoint
- `--streaming-uploads` as default
- Bucket tagging (real, not stubbed)
- CORS configuration per-bucket
- Browser-direct upload UX docs (presigned URL workflow walkthrough)
