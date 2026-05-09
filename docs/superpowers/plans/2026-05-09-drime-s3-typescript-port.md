# Drime S3 TypeScript (Bun) Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Bun-based S3-compatible gateway at the repo root that talks to Drime Cloud, uses a **dedicated Drime workspace** (default name `drime-s3`, created via `POST /workspace` and discovered via `GET /me/workspaces`) where **root-level folders are S3 buckets**, verifies Sig V4 (with `--insecure` escape hatch), and covers the scope in `docs/superpowers/specs/2026-05-09-drime-s3-typescript-port-design.md`.

**Architecture:** Thin `DrimeClient` over `fetch` with retries; S3 layer builds/parses XML and maps operations to Drime + R2 multipart endpoints; metadata lives in Drime `description` JSON; in-memory folder/list/multipart caches per spec.

**Tech Stack:** Bun 1.2+, TypeScript 5.x, `pino`, `fast-xml-parser`, `smol-toml`, `biome`, `bun:test`.

**Prerequisite:** Before heavy implementation, create a git worktree or feature branch per `superpowers:using-git-worktrees` if the repo is under git; do not commit on `main` without explicit consent.

---

## File map (create unless noted)

| Path | Responsibility |
|------|----------------|
| `package.json` | Scripts: `dev`, `test`, `typecheck`, `lint`, `build` |
| `tsconfig.json` | `strict`, `moduleResolution: "bundler"`, `types: ["bun-types"]` |
| `biome.json` | Lint/format defaults |
| `src/config.ts` | Load env + `~/.config/drime-s3/config.toml`, merge precedence |
| `src/util/logger.ts` | Pino child with `req_id` |
| `src/drime/types.ts` | `FileEntry`, API JSON shapes |
| `src/drime/metadata.ts` | Read/write `description` blob v1 + legacy `md5:` |
| `src/drime/client.ts` | DrimeClient + workspace ensure/resolve |
| `src/drime/workspace.ts` | Parse workspace list/create JSON |
| `src/cache/folder-paths.ts` | Lowercased path → folder id, eviction by prefix |
| `src/cache/list-ttl.ts` | 5s TTL + single-flight per folder id |
| `src/multipart/session-store.ts` | Composite upload id, part sizes/md5s, caps/TTL sweep |
| `src/s3/errors.ts` | XML error bodies + status |
| `src/s3/xml.ts` | ListBuckets, ListBucketResult V1/V2, DeleteResult, multipart XML |
| `src/s3/naming.ts` | Bucket name rules, path normalize |
| `src/s3/router.ts` | Parse bucket/key/query, dispatch |
| `src/s3/handlers/*.ts` | Per-operation handlers (see spec §4.1) |
| `src/auth/sigv4.ts` | Canonical request + signing key + verify |
| `src/auth/chunked-decoder.ts` | `TransformStream` for streaming SigV4 payload |
| `src/auth/presigned.ts` | Query-string Sig V4 verify + expiry |
| `src/cli/main.ts` | `serve`, `init`, `print-config` |
| `src/cli/init.ts` | Ensure gateway Drime workspace exists (`GET /me/workspaces` + `POST /workspace`), idempotent |
| `src/server.ts` | Compose deps, `Bun.serve`, graceful shutdown |
| `tests/fixtures/mock-drime/server.ts` | Minimal Drime API stub |
| `.github/workflows/ci.yml` | `bun install`, typecheck, lint, test |

---

### Task 1: Repo scaffold and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `.gitignore` (node_modules, dist, .env)
- Create: `README.md` (one paragraph + link to design spec + `bun install` / `bun run dev`)

- [ ] **Step 1: Initialize Bun project**

Run:

```bash
cd /Users/ayoub/Developer/OpenSource/drime-s3 && bun init -y
```

Expected: `package.json` created. Then set `"type": "module"`, `"private": true`.

- [ ] **Step 2: Add dependencies**

Run:

```bash
bun add pino fast-xml-parser smol-toml
bun add -d @types/bun typescript biome lefthook
```

Expected: `bun.lock` updated, `node_modules/` populated.

- [ ] **Step 3: Write `package.json` scripts**

Add to `package.json`:

```json
{
  "scripts": {
    "dev": "bun --hot run src/cli/main.ts serve",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome format --write .",
    "build": "bun build src/cli/main.ts --outdir=dist --target=bun"
  }
}
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun-types"],
    "rootDir": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 5: Write minimal `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "indentStyle": "space", "indentWidth": 2 }
}
```

- [ ] **Step 6: Verify**

Run:

```bash
bun run typecheck
bun run lint
```

Expected: Pass (empty project may pass with no files; add `src/empty.ts` temporarily if needed, then remove after Task 2).

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock tsconfig.json biome.json .gitignore README.md
git commit -m "chore: scaffold Bun TypeScript gateway project"
```

---

### Task 2: Config loader and secrets

**Files:**
- Create: `src/config.ts`
- Create: `tests/unit/config.test.ts`

- [ ] **Step 1: Write failing test for env override**

`tests/unit/config.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  beforeEach(() => {
    delete process.env.DRIME_API_KEY;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.DRIME_S3_INSECURE;
  });
  afterEach(() => {
    delete process.env.DRIME_API_KEY;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.DRIME_S3_INSECURE;
  });

  test("env overrides file for api key", async () => {
    process.env.DRIME_API_KEY = "env-key";
    const c = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(c.drime.apiKey).toBe("env-key");
  });
});
```

Run: `bun test tests/unit/config.test.ts`

Expected: FAIL (module missing or export missing).

- [ ] **Step 2: Implement `loadConfig`**

`src/config.ts` — export types `AppConfig`, `S3AuthConfig`, `DrimeConfig`, `ServerConfig`. Behavior:

1. Parse optional TOML from `configPath` arg or `~/.config/drime-s3/config.toml` via `smol-toml` + `Bun.file().text()`.
2. Merge: TOML defaults, then env overrides: `DRIME_API_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `DRIME_S3_HOST`, `DRIME_S3_PORT`, `DRIME_S3_INSECURE` (`"1"` or `"true"` → boolean).
3. `drime.apiBaseUrl` default `https://app.drime.cloud/api/v1` (match `python-port/drime_s3/api.py`).
4. If `s3.accessKey` / `s3.secretKey` missing after merge, generate random keys (prefix access key with `DRIMES3` + alphanumeric to length 20; secret 40 bytes base64url) — only when writing new file path is handled in Task 13 `print-config` / init; for `loadConfig` alone, **throw** `ConfigError` if keys missing and no insecure mode (caller may generate file in CLI).

Export:

```typescript
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type AppConfig = {
  s3: { accessKey: string; secretKey: string; region: string };
  drime: { apiKey: string; apiBaseUrl: string };
  server: { host: string; port: number };
  insecure: boolean;
};

export async function loadConfig(opts?: {
  configPath?: string;
}): Promise<AppConfig> {
  // implementation
}
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/config.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat(config): load TOML with env overrides"
```

---

### Task 3: Drime types and metadata blob

**Files:**
- Create: `src/drime/types.ts`
- Create: `src/drime/metadata.ts`
- Create: `tests/unit/drime/metadata.test.ts`

- [ ] **Step 1: Write failing tests for metadata**

`tests/unit/drime/metadata.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { readMetadata, mergeMetadata, serializeMetadata } from "../../../src/drime/metadata";

test("legacy md5: prefix", () => {
  expect(readMetadata("md5:abc")).toEqual({ md5: "abc" });
});

test("v1 json roundtrip", () => {
  const m = mergeMetadata(null, { md5: "deadbeef", ct: "text/plain", meta: { a: "1" } });
  const s = serializeMetadata(m);
  expect(readMetadata(s)).toMatchObject({ v: 1, md5: "deadbeef", ct: "text/plain", meta: { a: "1" } });
});

test("free-form description is preserved read-only", () => {
  const raw = "User note about vacation photos";
  expect(readMetadata(raw)).toEqual({ description: raw });
  expect(mergeMetadata(raw, { md5: "x" })).toEqual({ description: raw }); // no merge into JSON per spec §7.3
});
```

Run: `bun test tests/unit/drime/metadata.test.ts`

Expected: FAIL.

- [ ] **Step 2: Implement `metadata.ts`**

`src/drime/metadata.ts`:

```typescript
export type MetadataV1 = {
  v: 1;
  md5?: string;
  ct?: string;
  meta?: Record<string, string>;
  tags?: Record<string, string>;
};

export type ReadMetadata =
  | MetadataV1
  | { md5: string }
  | { description: string };

export function readMetadata(description: string | null): ReadMetadata {
  if (!description) return { v: 1 };
  if (description.startsWith("md5:")) return { md5: description.slice(4) };
  try {
    const parsed: unknown = JSON.parse(description);
    if (parsed && typeof parsed === "object" && (parsed as MetadataV1).v === 1) {
      return parsed as MetadataV1;
    }
  } catch {
    /* ignore */
  }
  return { description };
}

export function mergeMetadata(
  current: string | null,
  patch: Partial<MetadataV1>,
): MetadataV1 | { description: string } {
  const cur = readMetadata(current);
  if ("description" in cur) return cur;
  const base: MetadataV1 =
    "v" in cur && cur.v === 1 ? { ...cur, v: 1 } : { v: 1, ...(cur as { md5?: string }) };
  return { ...base, ...patch, v: 1 };
}

export function serializeMetadata(m: MetadataV1): string {
  const copy = { ...m, v: 1 as const };
  if (copy.meta && Object.keys(copy.meta).length === 0) delete copy.meta;
  if (copy.tags && Object.keys(copy.tags).length === 0) delete copy.tags;
  return JSON.stringify(copy);
}
```

Adjust tests if spec says merge should return unchanged for free-form — the test expects `mergeMetadata` to **not** embed md5 when description is free-form; implement that branch explicitly.

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/drime/types.ts src/drime/metadata.ts tests/unit/drime/metadata.test.ts
git commit -m "feat(drime): FileEntry types and description metadata helpers"
```

---

### Task 4: Drime HTTP client with retries

**Files:**
- Create: `src/drime/client.ts`
- Create: `tests/unit/drime/client.test.ts`

- [ ] **Step 1: Write failing test — retries on 503**

Use `globalThis.fetch` mock: first call returns `Response` with status 503, second returns 200 JSON `{ data: [] }`.

Assert `listFolderEntries(null)` resolves after 2 calls.

Run: `bun test tests/unit/drime/client.test.ts` — expect FAIL.

- [ ] **Step 2: Implement `DrimeClient`**

Constructor `(opts: { apiKey: string; apiBaseUrl: string; fetchFn?: typeof fetch })`.

Methods (names can vary but surface must exist):

- `request(method, path, init?)` — sets `Authorization: Bearer ${apiKey}`, URL = `apiBaseUrl + path`, retries per spec §11.2: 5 attempts, backoff `500ms * attempt`, retry on network throw and 429/502/503/504. **Do not retry** `POST /uploads` (detect path).
- `listFolder(parentId, workspaceId)` — paginate `GET /drive/file-entries` with the gateway **`workspaceId`** (not hardcoded `0` in production).
- `createFolder(name, opts?)` — `POST /folders` JSON `{ name, workspaceId, parentId? }`.
- `uploadFile(params)` — `POST /uploads` multipart: `workspaceId` string from params (gateway id).
- `listWorkspaces()` — `GET /me/workspaces`
- `createWorkspace(name)` — `POST /workspace` body `{"name":...}`
- `ensureGatewayWorkspace(name)` — idempotent init
- `resolveGatewayWorkspaceId({ name, pinnedId? })` — for `serve`; throws if missing
- `deleteEntriesForever(ids: number[])` — use **`POST /file-entries/delete`** JSON `{ entryIds: ids, deleteForever: true }` to match `python-port/drime_s3/api.py` (not only swagger `DELETE /file-entries`).

Export `DrimeApiError` with `{ status, body }`.

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/drime/client.ts tests/unit/drime/client.test.ts
git commit -m "feat(drime): HTTP client with retries and core drive endpoints"
```

---

### Task 5: Caches (folder paths + list TTL)

**Files:**
- Create: `src/cache/folder-paths.ts`
- Create: `src/cache/list-ttl.ts`
- Create: `tests/unit/cache/list-ttl.test.ts`

- [ ] **Step 1: Test single-flight for list TTL**

Two concurrent `get(id)` when cache cold — underlying `fetchList` called once. Use a deferred promise in test double.

- [ ] **Step 2: Implement both modules per spec §10**

`FolderPathCache`: `get(path)`, `set(path, id)`, `evictPrefix(lowerPathPrefix)`.

`ListTtlCache`: `getOrFetch(folderId, fetcher)` with `Map` inflight + 5s TTL + optional byte estimate soft cap (simplified: cap number of cached folders at 5000 entries first; document full 100MB LRU as follow-up).

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cache/folder-paths.ts src/cache/list-ttl.ts tests/unit/cache/list-ttl.test.ts
git commit -m "feat(cache): folder path map and TTL list cache with single-flight"
```

---

### Task 6: S3 XML helpers, errors, bucket naming

**Files:**
- Create: `src/s3/errors.ts`, `src/s3/xml.ts`, `src/s3/naming.ts`
- Create: `tests/unit/s3/naming.test.ts`, `tests/unit/s3/xml.test.ts`

- [ ] **Step 1: Tests for bucket name validation**

Cases: valid `my-bucket-1`, invalid `MyBucket`, invalid `192.168.0.1`, invalid `ab`, invalid `xn--evil`.

- [ ] **Step 2: Implement `isValidBucketName` + `normalizeS3Key`**

Per spec §5.2.

- [ ] **Step 3: Implement `errors.ts`**

Function `s3ErrorXml(code: string, message: string): string` wrapping `<Error>` with xmlns `http://s3.amazonaws.com/doc/2006-03-01/`.

- [ ] **Step 4: Implement `xml.ts` builders**

At minimum: `ListAllMyBucketsResult`, `ListBucketResult` (V1), `ListBucketResult` V2 fields (`ListBucketResult` root with `KeyCount`, `ContinuationToken`, `NextContinuationToken`, `IsTruncated`), `DeleteResult`, `InitiateMultipartUploadResult`, `CompleteMultipartUploadResult`, `CopyObjectResult`.

Use `fast-xml-parser` XMLBuilder with correct attribute ordering where required.

- [ ] **Step 5: Run tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/s3/errors.ts src/s3/xml.ts src/s3/naming.ts tests/unit/s3/
git commit -m "feat(s3): errors, XML builders, and bucket naming rules"
```

---

### Task 7: Sig V4 verification (header)

**Files:**
- Create: `src/auth/sigv4.ts`
- Create: `tests/unit/auth/sigv4.test.ts`

- [ ] **Step 1: Add a known-good fixture**

Use AWS example canonical request + signing key (pick one official SigV4 unit test vector for `GET` + empty payload). Store expected signature hex in test.

- [ ] **Step 2: Implement `verifySignatureV4(request: Request, opts: { method: string; url: URL; headers: Headers; bodySha256?: string }, credentials: { accessKey: string; secretKey: string })`**

Steps: parse `Authorization` header, extract `Credential` scope and `SignedHeaders`, rebuild canonical request per AWS spec, derive signing key `HMAC("AWS4" + secret, date) → region → service → "aws4_request"`, compare signatures in constant time.

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/auth/sigv4.ts tests/unit/auth/sigv4.test.ts
git commit -m "feat(auth): AWS Sig V4 request verification"
```

---

### Task 8: Chunked Sig V4 payload decoder

**Files:**
- Create: `src/auth/chunked-decoder.ts`
- Create: `tests/unit/auth/chunked-decoder.test.ts`

- [ ] **Step 1: Test with synthetic stream**

Build a `ReadableStream` of one chunk: `"5;chunk-signature=0000000000000000000000000000000000000000000000000000000000000000\r\nhello\r\n0;chunk-signature=0000000000000000000000000000000000000000000000000000000000000000\r\n\r\n"` (adjust chunk signature to match real HMAC when verification on).

For `--insecure` path, decoder skips HMAC verify but still outputs `hello`.

- [ ] **Step 2: Implement `TransformStream` decoder**

Per spec §6.2: parse hex size, optional extensions, CRLF, read N bytes, CRLF, until terminal chunk.

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/auth/chunked-decoder.ts tests/unit/auth/chunked-decoder.test.ts
git commit -m "feat(auth): streaming AWS chunked payload decoder"
```

---

### Task 9: Multipart session store + composite UploadId

**Files:**
- Create: `src/multipart/session-store.ts`
- Create: `tests/unit/multipart/session-store.test.ts`

- [ ] **Step 1: Tests**

Encode/decode `v1.` + base64url JSON `{ uid, key }`. Legacy decode without prefix. TTL eviction: mock clock optional; at minimum test cap eviction drops oldest.

- [ ] **Step 2: Implement**

Match Python composite ID behavior from `python-port/drime_s3/gateway.py` (`_encode_multipart_id` / `_decode_multipart_id`) plus `v1.` prefix from design.

- [ ] **Step 3: Commit**

```bash
git add src/multipart/session-store.ts tests/unit/multipart/session-store.test.ts
git commit -m "feat(multipart): in-memory session store and upload id codec"
```

---

### Task 10: Mock Drime server (integration fixture)

**Files:**
- Create: `tests/fixtures/mock-drime/server.ts`

- [ ] **Step 1: Implement minimal routes**

`Bun.serve` on ephemeral port (pass `0`), handle:

- `GET /drive/file-entries` — return paginated JSON matching Python expectations (`data`, `last_page`).
- `POST /folders` — return `{ folder: { id, name, type: "folder", ... } }`.
- `POST /uploads` — return `{ fileEntry: { id, name, type: "text", file_size: 0, ... } }`.
- `POST /file-entries/delete` — return `{ status: "success" }`.
- `POST /s3/multipart/create`, `batch-sign-part-urls`, `complete`, `abort` — return canned JSON; for part upload URL use same server's `PUT /mock-part` that echoes ETag header.

Export `startMockDrime(): Promise<{ baseUrl: string; stop(): void }>`.

- [ ] **Step 2: Smoke test**

`bun test tests/integration/mock-drime-smoke.test.ts` that starts server, `fetch` one route, stops.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/mock-drime/server.ts tests/integration/mock-drime-smoke.test.ts
git commit -m "test: add mock Drime HTTP server for integration tests"
```

---

### Task 11: Router + auth gate + gateway workspace resolution

**Files:**
- Create: `src/s3/router.ts`
- Create: `src/server-context.ts` (optional barrel wiring `AppContext`)
- Create: `tests/integration/router-health.test.ts`

- [ ] **Step 1: Define `AppContext`**

Holds `config`, `drime`, `gatewayWorkspaceId` (number `W`), `folderCache`, `listCache`, `multipartStore`, `logger`.

- [ ] **Step 2: Implement `dispatch(req: Request): Promise<Response>`**

Order:

1. Generate `x-amz-request-id` (UUID).
2. If `req.method === "OPTIONS"` and path matches bucket/object — delegate CORS handler (stub: `204` with `Access-Control-Allow-Origin: *` for v1 per design Tier 3).
3. If path `/_health` and host is localhost — return JSON caches sizes.
4. Parse S3 path: service `GET /` vs `/<bucket>/...` vs `/<bucket>`.
5. **Auth:** unless `config.insecure`, call Sig V4 verify; on presigned query params, branch to `auth/presigned.ts`.
6. **Workspace `W`:** from `config.drime.gatewayWorkspaceId` or `drime.resolveGatewayWorkspaceId({ name: config.drime.gatewayWorkspaceName })` once at startup (cached on context). If missing — **503** instructing `drime-s3 init` (do not auto-create on serve).

- [ ] **Step 3: Integration test**

Start mock Drime with `GET /me/workspaces` returning `[{ id: 1, name: "drime-s3" }]`, hit `GET /` with `insecure: true` — expect `200` XML ListBuckets (mock lists root folders of workspace 1).

- [ ] **Step 4: Commit**

```bash
git add src/s3/router.ts src/server-context.ts tests/integration/router-health.test.ts
git commit -m "feat(s3): router skeleton with health and insecure auth path"
```

---

### Task 12: Bucket handlers (List/Create/Delete/Head + stubs)

**Files:**
- Create: `src/s3/handlers/service.ts`
- Create: `src/s3/handlers/bucket.ts`
- Modify: `src/s3/router.ts` (wire handlers)

- [ ] **Step 1: Integration tests**

- `PUT /newbucket` creates folder at **workspace root** (`POST /folders` with `workspaceId: W`, no `parentId`) in mock.
- `DELETE /newbucket` on empty bucket removes folder.
- `HEAD /newbucket` returns 404 before create, 200 after.

Use insecure auth for speed.

- [ ] **Step 2: Implement handlers per design §5**

`ListBuckets`: `listFolder(null, W)` (or Drime’s root-of-workspace listing), **folders only**, filtered by `isValidBucketName`.

`CreateBucket`: 409 if a root folder with that name already exists.

`DeleteBucket`: list immediate children of that bucket folder; if non-empty → 409.

Stubs: `GetBucketLocation`, `GetBucketVersioning`, `GetBucketAcl` return minimal XML bodies.

- [ ] **Step 3: Commit**

```bash
git add src/s3/handlers/service.ts src/s3/handlers/bucket.ts src/s3/router.ts tests/integration/bucket-crud.test.ts
git commit -m "feat(s3): bucket CRUD and list stubs"
```

---

### Task 13: ListObjects V1/V2 + folder walk + delimiter

**Files:**
- Modify: `src/s3/handlers/bucket.ts` (or split `list.ts` if file grows)
- Create: `tests/integration/list-objects.test.ts`

- [ ] **Step 1: Tests**

Seed mock with nested folders/files; assert `delimiter=/` returns `CommonPrefixes`; no delimiter returns recursive keys; `list-type=2` returns `KeyCount` + continuation when `MaxKeys` forced low (e.g. `2`).

- [ ] **Step 2: Implement**

Port resolution logic from `python-port/drime_s3/gateway.py`: `_find_folder_id`, `_list_recursive`, `_resolve_key` (note: file name match case for object per Python line 234-235 — preserve spec: folders case-insensitive, object name exact match as Python).

- [ ] **Step 3: Commit**

```bash
git add src/s3/handlers/bucket.ts tests/integration/list-objects.test.ts
git commit -m "feat(s3): list objects v1/v2 with delimiter and pagination"
```

---

### Task 14: Object handlers — HEAD/GET/DELETE/PUT (non-copy) + Range

**Files:**
- Create: `src/s3/handlers/object.ts`
- Modify: `src/s3/router.ts`
- Create: `tests/integration/object-crud.test.ts`

- [ ] **Step 1: Mock download URL**

Mock Drime returns `file-entries` with `url` pointing to `GET /mock-file/:id` that returns bytes.

- [ ] **Step 2: Tests**

PUT small object, HEAD, GET full, GET with `Range: bytes=1-2` returns `206` and correct 3 bytes (adjust to mock behavior).

DELETE returns `204`.

- [ ] **Step 3: Implement PUT pipeline default (temp file)**

Per design §8.2: spool via `Bun.write` to temp path under `Bun.env.TMPDIR`, compute MD5 via incremental hasher (`crypto.createHash` is Node; in Bun use `crypto.subtle.digest` on chunks or `Bun.CryptoHasher` if available — pick one documented in Bun).

After upload, `PUT /file-entries/{id}` to persist metadata JSON if Drime returns entry without description field populated.

- [ ] **Step 4: Commit**

```bash
git add src/s3/handlers/object.ts src/s3/router.ts tests/integration/object-crud.test.ts
git commit -m "feat(s3): object get/put/head/delete with range and metadata"
```

---

### Task 15: CopyObject + DeleteObjects batch + tagging

**Files:**
- Modify: `src/s3/handlers/object.ts` (copy branch)
- Create: `src/s3/handlers/batch.ts`
- Create: `src/s3/handlers/tagging.ts`
- Create: `tests/integration/copy-and-batch.test.ts`

- [ ] **Step 1: CopyObject test**

Upload `a.txt`, `CopyObject` to `b.txt`, GET `b.txt` matches.

- [ ] **Step 2: DeleteObjects test**

Two keys, one POST `?delete` with XML body, expect two `Deleted` entries.

- [ ] **Step 3: Tagging test**

PUT object with `x-amz-tagging: a=b`, GET `?tagging` returns XML.

- [ ] **Step 4: Implement**

Copy: download source to memory/temp (match Python approach for v1), re-upload to dest, merge metadata.

Batch: resolve keys in parallel, single `deleteEntriesForever`.

- [ ] **Step 5: Commit**

```bash
git add src/s3/handlers/object.ts src/s3/handlers/batch.ts src/s3/handlers/tagging.ts tests/integration/copy-and-batch.test.ts
git commit -m "feat(s3): copy object, batch delete, and object tagging"
```

---

### Task 16: S3 multipart pass-through to Drime multipart endpoints

**Files:**
- Create: `src/s3/handlers/multipart.ts`
- Modify: `src/s3/router.ts`
- Create: `tests/integration/multipart.test.ts`

- [ ] **Step 1: Extend mock** for `/s3/multipart/*` and `/s3/entries`.

- [ ] **Step 2: Integration test** Init → upload one part (to mock R2 URL) → complete → list contains object.

- [ ] **Step 3: Port Python logic** from `gateway.py` handlers `handle_create_multipart_upload`, `handle_upload_part`, `handle_complete_multipart_upload`, `handle_abort_multipart_upload` using `fetch` streaming.

- [ ] **Step 4: Commit**

```bash
git add src/s3/handlers/multipart.ts src/s3/router.ts tests/fixtures/mock-drime/server.ts tests/integration/multipart.test.ts
git commit -m "feat(s3): multipart upload proxy to Drime S3 endpoints"
```

---

### Task 17: CLI (`init`, `serve`, `print-config`) and process entry

**Files:**
- Create: `src/cli/main.ts`, `src/cli/init.ts`
- Modify: `package.json` bin field: `"drime-s3": "src/cli/main.ts"`

- [ ] **Step 1: `init` command**

Calls `drime.ensureGatewayWorkspace(config.drime.gatewayWorkspaceName)`; prints success message.

- [ ] **Step 2: `serve` command**

Loads config, resolves `W` via `resolveGatewayWorkspaceId` (503 if missing), refuses insecure+public bind without override per spec, starts `Bun.serve` from `src/server.ts`.

- [ ] **Step 3: Manual verification**

```bash
DRIME_API_KEY=dummy bun run src/cli/main.ts print-config
```

Expected: prints resolved paths and whether config file exists.

- [ ] **Step 4: Commit**

```bash
git add src/cli/main.ts src/cli/init.ts src/server.ts package.json
git commit -m "feat(cli): init and serve entrypoints"
```

---

### Task 18: Wire secure Sig V4 + presigned + CORS polish

**Files:**
- Modify: `src/auth/presigned.ts` (create if not created in Task 7 split)
- Modify: `src/s3/router.ts`

- [ ] **Step 1: Tests** with real `Authorization` header from `aws4` signing — optional: small helper using `@smithy/signature-v4` **dev-only** to generate headers in tests, or hand-craft one vector. Prefer dev dependency only in tests if it saves time; otherwise extend Task 7 vectors.

- [ ] **Step 2: Enable auth by default** in integration tests for one golden-path test.

- [ ] **Step 3: Commit**

```bash
git add src/auth/presigned.ts src/s3/router.ts tests/integration/auth-signed.test.ts
git commit -m "feat(auth): presigned URL verification and secure mode in router"
```

---

### Task 19: Docker + CI

**Files:**
- Create: `Dockerfile`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Dockerfile**

Based on `oven/bun:1` slim, `COPY` project, `CMD ["bun", "run", "src/cli/main.ts", "serve", "--host", "0.0.0.0"]`.

- [ ] **Step 2: CI**

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun test
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .github/workflows/ci.yml
git commit -m "chore: add Dockerfile and GitHub Actions CI"
```

---

### Task 20: README, CHANGELOG, and spec probes

**Files:**
- Modify: `README.md`
- Create: `CHANGELOG.md` with `## [Unreleased]` section documenting initial release scope.

- [ ] **Step 1: Document** env vars, `init` first (creates **Drime workspace** `drime-s3` if missing), `aws configure` example with endpoint `http://127.0.0.1:8081`, note **buckets = root folders in that workspace** (not the old Python `default` at global workspace 0).

- [ ] **Step 2: Run full suite**

```bash
bun test
bun run typecheck
bun run lint
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: README and changelog for TypeScript gateway"
```

---

## Plan self-review (spec coverage)

| Spec section | Tasks covering it |
|--------------|-------------------|
| §3 Decisions (E, Bun, tiers, auth D, stateless, layout, init) | Tasks 1–4, 11–13, 17–18 |
| §4 Module layout | Tasks 1–11, 12–16 |
| §5 Bucket model | Tasks 12–13 |
| §6 Auth | Tasks 7–8, 11, 18 |
| §7 Metadata | Tasks 3, 14–15 |
| §8 Hot paths (GET/PUT/multipart/list/delete) | Tasks 14–16 |
| §9 Streaming / range | Task 14 |
| §10 Caching | Tasks 5, 11–13 |
| §11 Errors/retry | Tasks 4, 11 |
| §12–13 Observability / lifecycle | Tasks 11, 17 |
| §14 Testing pyramid | Tasks 2–10, 11–16, 18 |
| §15 Distribution | Tasks 1, 19 (Docker/CI); npm publish / compile binary left as release checklist item — add Task 21 if desired |

**Gap to close optionally:** Add **Task 21: Release artifacts** — `bun build --compile` matrix + `npm publish` dry-run — if v1 must ship binaries immediately.

**Placeholder scan:** None intentional; all tasks name concrete files and commands.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-drime-s3-typescript-port.md`.

**Two execution options:**

1. **Subagent-driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration (`superpowers:subagent-driven-development`).

2. **Inline execution** — Run tasks in this session with `superpowers:executing-plans`, batching with checkpoints.

**Note:** `executing-plans` expects a loaded plan and (per its integration) using **`superpowers:using-git-worktrees`** before implementation if you use git—worth doing so work stays off `main`.

Which approach do you want?
