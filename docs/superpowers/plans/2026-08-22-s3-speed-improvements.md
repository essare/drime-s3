# S3 Speed Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise gateway PUT/GET throughput vs `docs/bench/baseline-2026-08-22.*` (large files **>2×** MiB/s; small files clearly faster), default ETag to speed with opt-in strong MD5, and fix empty-bucket DeleteBucket.

**Architecture:** Surgical hot-path changes only — env-tunable internal multipart part concurrency (higher default), skip full-body ETag buffering unless `DRIME_S3_STRONG_ETAG=1`, short-circuit `ensureParentFolderForPut` via `folderCache`, fix DeleteBucket emptiness check. Re-bench with `scripts/bench-baseline.ts`.

**Tech Stack:** Bun, TypeScript, `bun:test`, mock Drime fixtures, AWS CLI for live bench.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-22-s3-speed-improvements-design.md`
- Baseline: `docs/bench/baseline-2026-08-22.json` / `.md`
- Keep S3-compatible status codes and header shapes
- Do **not** implement streaming PUT / remove spool
- Do **not** implement UploadPartCopy
- Defaults favor speed; strong ETag is opt-in
- TDD: failing test before production code for each behavior change
- Branch: `feat/speed-improvements`

---

## File map

| File | Responsibility |
|------|----------------|
| `src/drime/multipart-upload.ts` | Part concurrency env + higher default |
| `src/s3/handlers/object.ts` | ETag policy; `ensureParentFolderForPut` cache short-circuit |
| `src/s3/handlers/bucket.ts` | `handleDeleteBucket` freshness / errors |
| `tests/unit/drime/multipart-concurrency.test.ts` | Concurrency parsing |
| `tests/unit/s3/etag-policy.test.ts` | Strong vs default buffering gate |
| `tests/unit/s3/ensure-parent-folder.test.ts` | folderCache short-circuit |
| `tests/integration/bucket-crud.test.ts` | Empty / non-empty DeleteBucket |
| `.env.example` | New env knobs |
| `README.md` | ETag / concurrency note |
| `docs/bench/optimized-<date>.*` | Post-change live numbers |

---

### Task 1: Tunable multipart part concurrency (default raised)

**Files:**
- Modify: `src/drime/multipart-upload.ts`
- Create: `tests/unit/drime/multipart-concurrency.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `export function getMultipartPartConcurrency(): number`
- Env: `DRIME_S3_MULTIPART_PART_CONCURRENCY` (positive int; invalid/missing → **12**)
- Uses existing `parsePositiveInt` in the same file
- Wire into `uploadFileViaInternalMultipart` (replace `const PART_CONCURRENCY = 4`)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/drime/multipart-concurrency.test.ts`:

```typescript
import { afterEach, describe, expect, test } from "bun:test";
import { getMultipartPartConcurrency } from "../../../src/drime/multipart-upload";

describe("getMultipartPartConcurrency", () => {
  const prev = process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY;
    } else {
      process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY = prev;
    }
  });

  test("defaults to 12 when unset", () => {
    delete process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY;
    expect(getMultipartPartConcurrency()).toBe(12);
  });

  test("reads positive env override", () => {
    process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY = "16";
    expect(getMultipartPartConcurrency()).toBe(16);
  });

  test("falls back to 12 on invalid env", () => {
    process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY = "nope";
    expect(getMultipartPartConcurrency()).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/drime/multipart-concurrency.test.ts`

Expected: FAIL (export missing)

- [ ] **Step 3: Minimal implementation**

In `src/drime/multipart-upload.ts`:

1. Delete `const PART_CONCURRENCY = 4`.
2. Add:

```typescript
const DEFAULT_PART_CONCURRENCY = 12;

export function getMultipartPartConcurrency(): number {
  return parsePositiveInt(
    process.env.DRIME_S3_MULTIPART_PART_CONCURRENCY,
    DEFAULT_PART_CONCURRENCY,
  );
}
```

3. In `uploadFileViaInternalMultipart`, change:

```typescript
const lanes = Math.min(PART_CONCURRENCY, partCount);
```

to:

```typescript
const lanes = Math.min(getMultipartPartConcurrency(), partCount);
```

- [ ] **Step 4: Re-run test**

Run: `bun test tests/unit/drime/multipart-concurrency.test.ts`

Expected: PASS

- [ ] **Step 5: Document in `.env.example`**

```bash
# Parallel part uploads for gateway-internal multipart PUT (default 12)
# DRIME_S3_MULTIPART_PART_CONCURRENCY=12
```

- [ ] **Step 6: Commit**

```bash
git add src/drime/multipart-upload.ts tests/unit/drime/multipart-concurrency.test.ts .env.example
git commit -m "$(cat <<'EOF'
feat(multipart): raise default part concurrency and make it tunable

Large PUTs were capped at 4 parallel parts; default 12 via DRIME_S3_MULTIPART_PART_CONCURRENCY.
EOF
)"
```

---

### Task 2: Default-fast ETag policy (opt-in strong MD5)

**Files:**
- Modify: `src/s3/handlers/object.ts`
- Create: `tests/unit/s3/etag-policy.test.ts`
- Modify: `.env.example`, `README.md`

**Interfaces:**
- Produces (export for tests):

```typescript
export function strongEtagEnabled(): boolean;

export function shouldBufferBodyForEtag(opts: {
  strongEtag: boolean;
  hasStrongMetadata: boolean;
  size: number;
  bufferMaxBytes: number;
  hasRange: boolean;
  upstreamStatus: number;
}): boolean;
```

- Env:
  - `DRIME_S3_STRONG_ETAG=1` or `true` → enable full-body MD5 path
  - When strong: `DRIME_S3_CONTENT_ETAG_BUFFER_BYTES` size cap (existing helper `contentEtagBufferMaxBytes()`, default 64 MiB)
  - Default (strong off): never buffer / never full-download for ETag

Wire into HEAD (today calls `etagQuotedFromFullDownload` when `!entryHasStrongContentEtag` && size ≤ max) and GET (`bufferBody` branch).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/s3/etag-policy.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { shouldBufferBodyForEtag } from "../../../src/s3/handlers/object";

describe("shouldBufferBodyForEtag", () => {
  const base = {
    hasStrongMetadata: false,
    size: 10 * 1024 * 1024,
    bufferMaxBytes: 64 * 1024 * 1024,
    hasRange: false,
    upstreamStatus: 200,
  };

  test("default (strongEtag false) never buffers", () => {
    expect(shouldBufferBodyForEtag({ ...base, strongEtag: false })).toBe(false);
  });

  test("strongEtag buffers weak metadata within max", () => {
    expect(shouldBufferBodyForEtag({ ...base, strongEtag: true })).toBe(true);
  });

  test("strongEtag skips when metadata already strong", () => {
    expect(
      shouldBufferBodyForEtag({
        ...base,
        strongEtag: true,
        hasStrongMetadata: true,
      }),
    ).toBe(false);
  });

  test("strongEtag skips Range and non-200", () => {
    expect(
      shouldBufferBodyForEtag({ ...base, strongEtag: true, hasRange: true }),
    ).toBe(false);
    expect(
      shouldBufferBodyForEtag({
        ...base,
        strongEtag: true,
        upstreamStatus: 206,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/s3/etag-policy.test.ts`

Expected: FAIL (export missing)

- [ ] **Step 3: Implement helper + wire HEAD/GET**

Add near `contentEtagBufferMaxBytes` in `object.ts`:

```typescript
export function strongEtagEnabled(): boolean {
  const raw = process.env.DRIME_S3_STRONG_ETAG?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export function shouldBufferBodyForEtag(opts: {
  strongEtag: boolean;
  hasStrongMetadata: boolean;
  size: number;
  bufferMaxBytes: number;
  hasRange: boolean;
  upstreamStatus: number;
}): boolean {
  if (!opts.strongEtag) return false;
  if (opts.hasStrongMetadata) return false;
  if (opts.hasRange) return false;
  if (opts.upstreamStatus !== 200) return false;
  if (opts.size < 0 || opts.size > opts.bufferMaxBytes) return false;
  return true;
}
```

HEAD — replace the weak-metadata full-download block with:

```typescript
let etag = etagFromFileEntry(entry);
if (
  shouldBufferBodyForEtag({
    strongEtag: strongEtagEnabled(),
    hasStrongMetadata: entryHasStrongContentEtag(entry),
    size: entry.file_size ?? 0,
    bufferMaxBytes: contentEtagBufferMaxBytes(),
    hasRange: false,
    upstreamStatus: 200,
  })
) {
  const q = await etagQuotedFromFullDownload(ctx, downloadUrl);
  if (q !== null) etag = q;
}
```

GET — replace the `bufferBody = ...` boolean with `shouldBufferBodyForEtag({ strongEtag: strongEtagEnabled(), hasStrongMetadata: strong, size: sz, bufferMaxBytes: maxBuf, hasRange: Boolean(range), upstreamStatus: upstream.status })`.

- [ ] **Step 4: Re-run unit test**

Run: `bun test tests/unit/s3/etag-policy.test.ts`

Expected: PASS

- [ ] **Step 5: Docs**

`.env.example`:

```bash
# Opt-in: download object body to compute strong MD5 ETag when metadata is weak (default off)
# DRIME_S3_STRONG_ETAG=1
# DRIME_S3_CONTENT_ETAG_BUFFER_BYTES=67108864
```

`README.md` — short note: default uses stored/weak ETag; set `DRIME_S3_STRONG_ETAG=1` for strict MD5 clients (e.g. Duplicati).

- [ ] **Step 6: Commit**

```bash
git add src/s3/handlers/object.ts tests/unit/s3/etag-policy.test.ts .env.example README.md
git commit -m "$(cat <<'EOF'
feat(s3): default-fast ETag; opt-in strong MD5 buffering

Stop full-object downloads for ETag unless DRIME_S3_STRONG_ETAG=1.
EOF
)"
```

---

### Task 3: `ensureParentFolderForPut` — `folderCache` short-circuit

**Files:**
- Modify: `src/s3/handlers/object.ts` (`ensureParentFolderForPut`)
- Create: `tests/unit/s3/ensure-parent-folder.test.ts`

**Current behavior:** Loop always calls `ctx.listCache.getOrFetch` then sets `folderCache`.  
**Change:** Before list, if `ctx.folderCache.get(normalizePathKey(\`${bucket}/${pathAccum}\`))` hits, use that id and `continue`.

**Interfaces:**
- Function stays: `ensureParentFolderForPut(ctx, W, bucketRootId, bucket, key)`
- Uses: `ctx.folderCache.get/set`, `ctx.listCache.getOrFetch` / `invalidate`, `ctx.drime.listFolder` / `createFolder`, `normalizePathKey`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/s3/ensure-parent-folder.test.ts` with a minimal stub `AppContext`:

- `folderCache`: real `FolderPathCache` from `src/cache/folder-paths.ts` (or Map wrapper matching `.get`/`.set`)
- `listCache.getOrFetch`: increment a counter, return stub entries
- `drime.listFolder` / `createFolder`: should not be needed if both segments are pre-cached

```typescript
test("uses folderCache and skips listCache when path segments are warm", async () => {
  // Pre-seed folderCache for "bkt/a" and "bkt/a/b"
  // Call ensureParentFolderForPut(ctx, 1, 10, "bkt", "a/b/file.bin")
  // Expect listFetchCount === 0 and result parentId === cached id for a/b
});
```

Also keep a cold-cache test that still lists/creates.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/s3/ensure-parent-folder.test.ts`

Expected: FAIL (listFetchCount > 0 on warm cache)

- [ ] **Step 3: Implement short-circuit**

At the start of the segment loop in `ensureParentFolderForPut`, after updating `pathAccum`:

```typescript
const cacheKey = normalizePathKey(`${bucket}/${pathAccum}`);
const cachedId = ctx.folderCache.get(cacheKey);
if (cachedId !== undefined) {
  currentPid = cachedId;
  continue;
}
```

Then existing list/find/create logic.

- [ ] **Step 4: Re-run test**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/s3/handlers/object.ts tests/unit/s3/ensure-parent-folder.test.ts
git commit -m "$(cat <<'EOF'
perf(s3): skip listFolder when parent path is in folderCache

Repeated PUTs under the same prefix avoid re-listing every ensure-parent segment.
EOF
)"
```

---

### Task 4: Fix DeleteBucket on empty buckets

**Files:**
- Modify: `src/s3/handlers/bucket.ts` (`handleDeleteBucket`)
- Modify: `tests/integration/bucket-crud.test.ts`

**Current code:** Lists via `ctx.drime.listFolder` (no pre-invalidate), 409 if children.length > 0, then `deleteEntriesForever`, invalidate caches, `204` with `null` body.

**Live bug:** `aws s3 rb` / `delete-bucket` fails with an empty error while listing looks empty — likely stale `listCache`, unexpected child rows, or empty error bodies on upstream failure.

- [ ] **Step 1: Write / extend failing tests**

In `tests/integration/bucket-crud.test.ts` add:

```typescript
test("DELETE non-empty bucket returns 409 BucketNotEmpty; empty returns 204", async () => {
  // PUT bucket, PUT object (via dispatch PUT object or seed mock children),
  // DELETE bucket → 409, body contains BucketNotEmpty
  // DELETE object, DELETE bucket → 204
  // HEAD bucket → 404
});
```

If mock already covers empty 204, the new value is the non-empty 409 path plus any stale-cache scenario you can seed.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/bucket-crud.test.ts`

Expected: FAIL on new assertions

- [ ] **Step 3: Fix `handleDeleteBucket`**

In `src/s3/handlers/bucket.ts`:

1. `ctx.listCache.invalidate(folder.id)` **before** listing.
2. Prefer a fresh `await ctx.drime.listFolder(folder.id, W)` for the emptiness decision (do not trust TTL cache for destructive ops).
3. Filter out any entry with `e.id === folder.id` if Drime ever echoes the folder itself.
4. Keep 409 `BucketNotEmpty` when remaining children.length > 0.
5. On `deleteEntriesForever` failure, return `xmlErr(500, "InternalError", message)` with a **non-empty** message.
6. Success response — if CLI still chokes on `new Response(null, { status: 204 })`, use:

```typescript
return new Response("", {
  status: 204,
  headers: { "Content-Length": "0" },
});
```

- [ ] **Step 4: Re-run integration tests**

Expected: PASS

- [ ] **Step 5: Live smoke**

```bash
DRIME_S3_INSECURE=0 bun run src/cli/main.ts serve
# other terminal:
aws --endpoint-url http://127.0.0.1:8081 s3 mb s3://bench-delete-smoke
aws --endpoint-url http://127.0.0.1:8081 s3 rb s3://bench-delete-smoke
```

Expected: both succeed. Clean leftover `bench-20260822*` if present.

- [ ] **Step 6: Commit**

```bash
git add src/s3/handlers/bucket.ts tests/integration/bucket-crud.test.ts
git commit -m "$(cat <<'EOF'
fix(s3): make DeleteBucket succeed for empty buckets

Fresh list before emptiness check and non-empty error bodies so aws s3 rb works.
EOF
)"
```

---

### Task 5: Regression suite + live optimized bench

**Files:**
- Create: `docs/bench/optimized-YYYY-MM-DD.json` + `.md`
- Optionally: small filename/label tweak in `scripts/bench-baseline.ts` if needed

- [ ] **Step 1: Automated gates**

```bash
bun test
bun run typecheck
bun run lint
```

Expected: all green

- [ ] **Step 2: Start gateway (Sig V4)**

```bash
DRIME_S3_INSECURE=0 bun run src/cli/main.ts serve
```

Confirm `print-config` shows `insecure: false`.

- [ ] **Step 3: Run bench**

```bash
DRIME_S3_INSECURE=0 bun run scripts/bench-baseline.ts http://127.0.0.1:8081
```

Save/rename to `docs/bench/optimized-YYYY-MM-DD.{json,md}` with a comparison table vs baseline medians (PUT/GET 10/100/512 MiB, HEAD 10 MiB, DeleteBucket).

- [ ] **Step 4: Acceptance check**

| Metric | Required |
|--------|----------|
| PUT/GET 100 & 512 MiB median MiB/s | **>2×** baseline |
| PUT/GET 10 MiB | Clearly faster |
| HEAD 10 MiB (default ETag) | Near large-object HEAD (~280 ms), not ~1.7 s |
| DeleteBucket | Empty bucket deletes via CLI |

If large PUT/GET miss >2× at concurrency 12, one live retry with `DRIME_S3_MULTIPART_PART_CONCURRENCY=16` and record it in the MD. If still short, **stop and report** — do not start Approach B in this plan.

- [ ] **Step 5: Commit artifacts**

```bash
git add docs/bench/optimized-*.json docs/bench/optimized-*.md
git commit -m "$(cat <<'EOF'
docs(bench): add optimized run vs 2026-08-22 baseline

Record post-speed-work medians for the PUT/GET ladder and DeleteBucket.
EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Multipart concurrency tunable + higher default | Task 1 |
| Small PUT faster (parent ensure) | Task 3 |
| Default-fast ETag + opt-in strong | Task 2 |
| GET no buffer by default | Task 2 |
| DeleteBucket fix | Task 4 |
| Re-bench; >2× large; small clearly faster | Task 5 |
| No streaming PUT / no UploadPartCopy | Honored |
| Docs for env knobs | Tasks 1–2 |

Symbol names match repo: `uploadFileViaInternalMultipart`, `ensureParentFolderForPut`, `handleDeleteBucket`, `entryHasStrongContentEtag`, `etagFromFileEntry`, `contentEtagBufferMaxBytes`, `parsePositiveInt`, `listCache.getOrFetch`, `folderCache`, `normalizePathKey`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-22-s3-speed-improvements.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with `executing-plans` checkpoints  

Which approach?
